"""只读 ZIP 知识检索。仅处理文本，不执行脚本、不请求讲义中的远程图片。"""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path, PurePosixPath

from .contracts import Source

DEFAULT_KNOWLEDGE = Path(__file__).resolve().parents[2] / "resources" / "agent" / "knowledge"
PLATFORMS = frozenset({"xiaohongshu", "pinduoduo"})
STOP_WORDS = frozenset(
    {
        "怎么",
        "什么",
        "一个",
        "可以",
        "如何",
        "我们",
        "这个",
        "需要",
        "现在",
        "一下",
        "我想",
        "帮我",
        "你的",
        "我的",
    }
)


def terms(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).lower()
    result = re.findall(r"[a-z0-9]+", text)
    for run in re.findall(r"[\u4e00-\u9fff]+", text):
        result.extend(
            run[i : i + 2] for i in range(len(run) - 1) if run[i : i + 2] not in STOP_WORDS
        )
    return result


@dataclass(frozen=True)
class KnowledgeHit:
    source: Source
    text: str


@dataclass
class KnowledgeIndex:
    chunks: list[KnowledgeHit]
    postings: dict[str, list[tuple[int, int]]]
    lengths: list[int]
    title_terms: list[set[str]]
    documents: int
    image_only_documents: int

    def search(self, query: str, limit: int) -> list[KnowledgeHit]:
        if not self.chunks:
            return []
        count = len(self.chunks)
        average = sum(self.lengths) / count
        scores: dict[int, float] = defaultdict(float)
        for term in set(terms(query)):
            matches = self.postings.get(term, [])
            idf = math.log(1 + (count - len(matches) + 0.5) / (len(matches) + 0.5))
            for index, frequency in matches:
                norm = 1.2 * (0.25 + 0.75 * self.lengths[index] / max(average, 1))
                scores[index] += idf * frequency * 2.2 / (frequency + norm)
                if term in self.title_terms[index]:
                    scores[index] += idf * 1.5
        # 同一长课程最多占两个片段，保留不同资料的互证机会。
        seen: Counter[str] = Counter()
        hits = []
        for index in sorted(scores, key=lambda i: (-scores[i], self.chunks[i].source.id)):
            hit = self.chunks[index]
            document_id = hit.source.id.rsplit("#", 1)[0]
            if seen[document_id] >= 2:
                continue
            seen[document_id] += 1
            hits.append(hit)
            if len(hits) == limit:
                break
        return hits


def _plain_text(text: str) -> tuple[str, bool]:
    images = re.findall(r"!\[[^\]]*\]\([^\n]*\)", text)
    text = re.sub(r"!\[[^\]]*\]\([^\n]*\)", "", text)
    text = re.sub(r"<img\b[^>]*>", "", text, flags=re.IGNORECASE)
    body = text.split("## 课程正文", 1)[-1]
    image_only = bool(images) and len(re.sub(r"\s", "", body)) < 80
    text = re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", text).strip()
    if image_only:
        text += "\n资料边界：讲义为图片，图片正文尚未提取；只能参考标题与课程简介。"
    return text, image_only


@lru_cache(maxsize=4)
def _build_index(
    path_string: str, expected_hash: str, signature: tuple[int, int]
) -> KnowledgeIndex:
    path = Path(path_string)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError("Knowledge archive checksum mismatch")
    platform = path.stem
    chunks = []
    postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
    lengths = []
    titles = []
    documents = image_only_count = 0
    seen_documents = set()
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 10_000 or sum(e.file_size for e in entries) > 64 * 1024 * 1024:
            raise ValueError("Knowledge archive exceeds limits")
        for entry in sorted(entries, key=lambda e: e.filename):
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or ".." in name.parts or "\\" in entry.filename:
                raise ValueError("Unsafe archive entry")
            if (
                entry.is_dir()
                or name.suffix.lower() not in {".txt", ".md"}
                or name.name.lower() == "readme.md"
            ):
                continue
            if entry.file_size > 2 * 1024 * 1024:
                raise ValueError("Knowledge document exceeds limits")
            raw = archive.read(entry).decode("utf-8-sig")
            digest = hashlib.sha256(raw.encode()).hexdigest()
            if digest in seen_documents:
                continue
            seen_documents.add(digest)
            plain, image_only = _plain_text(raw)
            if not plain:
                continue
            title = next(
                (line[2:].strip() for line in raw.splitlines() if line.startswith("# ")),
                re.sub(r"^\d+_", "", name.stem),
            )
            original = re.search(r"原文链接[：:]\s*(https://[^\s]+)", raw)
            url = original.group(1) if original else None
            relative = PurePosixPath(*name.parts[1:]).as_posix()
            documents += 1
            image_only_count += int(image_only)
            for offset in range(0, len(plain), 1000):
                piece = plain[offset : offset + 1200]
                # 每个片段保留标题和资料边界，避免脱离原文语境。
                text = f"课程：{title}\n{piece}"
                if image_only:
                    text += "\n此来源仅包含课程简介，讲义图片内容未知。"
                source = Source(
                    id=f"knowledge:{platform}/{relative}#chunk-{offset // 1000}",
                    title=title,
                    url=url,
                )
                index = len(chunks)
                chunks.append(KnowledgeHit(source=source, text=text))
                frequencies = Counter(terms(text))
                lengths.append(max(1, sum(frequencies.values())))
                titles.append(set(terms(title)))
                for term, frequency in frequencies.items():
                    postings[term].append((index, frequency))
    return KnowledgeIndex(chunks, dict(postings), lengths, titles, documents, image_only_count)


class KnowledgeStore:
    def __init__(self, root: str | Path = "") -> None:
        self.root = Path(root).resolve() if root else DEFAULT_KNOWLEDGE

    def index(self, platform: str | None) -> KnowledgeIndex | None:
        if platform not in PLATFORMS:
            return None
        manifest_path = self.root / "manifest.json"
        if not manifest_path.exists():
            return None
        manifest = json.loads(manifest_path.read_text("utf-8"))
        item = manifest.get("archives", {}).get(platform)
        if item is None:
            return None
        if item["file"] != f"{platform}.zip":
            raise ValueError("Unexpected archive filename")
        path = self.root / item["file"]
        stat = path.stat()
        return _build_index(str(path), item["sha256"], (stat.st_mtime_ns, stat.st_size))

    def search(self, platform: str | None, query: str, *, limit: int = 4) -> list[KnowledgeHit]:
        if not 1 <= limit <= 8:
            raise ValueError("Knowledge result limit must be between 1 and 8")
        index = self.index(platform)
        return index.search(query, limit) if index else []
