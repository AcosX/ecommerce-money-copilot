"""仅加载部署者配置的目录；复用现有 Skill ZIP，不执行其中脚本。"""

import hashlib
import json
import re
import zipfile
from pathlib import Path

from .contracts import Source
from .knowledge_store import KnowledgeStore

DEFAULT_CONTENT = Path(__file__).resolve().parents[3] / "assets" / "skills"
KNOWLEDGE = Path(__file__).resolve().parent / "knowledge"

LEVEL_SKILLS = {
    "L1": ["category-business-advisor"],
    "L2": ["{p}-product-scout"],
    "L3": ["xhs-visual-material", "pdd-listing-optimizer"],
    "L4": ["pdd-listing-optimizer", "pdd-keyword-title"],
    "L5": ["{p}-video-script", "xhs-note-optimizer", "xhs-keyword-topic"],
    "L6": ["{p}-ads-doctor", "xhs-competitor-analyzer"],
}


def tokens(text: str) -> set[str]:
    text = text.lower()
    return set(re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]{2}", text)) | {
        text[i : i + 2]
        for i in range(len(text) - 1)
        if all("\u4e00" <= c <= "\u9fff" for c in text[i : i + 2])
    }


class ContentCatalog:
    def __init__(self, root: str = "", knowledge_root: str = "") -> None:
        self.root = Path(root).resolve() if root else DEFAULT_CONTENT
        self.knowledge = KnowledgeStore(knowledge_root)

    def load(self, level: str, platform: str | None, query: str) -> tuple[list, list, str]:
        prefix = "pdd" if platform == "pinduoduo" else "xhs"
        registry = self.root / "agent-catalog.json"
        mapping = {**LEVEL_SKILLS}
        if registry.exists():
            mapping.update(json.loads(registry.read_text("utf-8")))
        ids = [s.format(p=prefix) for s in mapping.get(level, [])]
        if any(not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", s) for s in ids):
            raise ValueError("Invalid skill id")
        # 未定平台时仅加载通用规划 Skill；避免把另一个平台的规则带入。
        if platform not in ("xiaohongshu", "pinduoduo") and level != "L1":
            ids = []
        ids = [
            s
            for s in ids
            if not (
                (s.startswith("xhs-") and prefix == "pdd")
                or (s.startswith("pdd-") and prefix == "xhs")
            )
        ]
        documents = []
        loaded = []
        manifest_path = self.root / "manifest.json"
        manifest = json.loads(manifest_path.read_text("utf-8")) if manifest_path.exists() else {}
        for skill_id in ids:
            archive = self.root / f"{skill_id}.zip"
            directory = self.root / skill_id
            if directory.is_dir() and (directory / "SKILL.md").is_file():
                for path in [
                    directory / "SKILL.md",
                    *sorted((directory / "references").glob("*.md")),
                ]:
                    if not path.resolve().is_relative_to(self.root.resolve()):
                        raise ValueError("Skill path outside content root")
                    if path.stat().st_size <= 64_000:
                        documents.append(
                            (
                                f"skill:{skill_id}/{path.relative_to(directory)}",
                                path.read_text("utf-8-sig"),
                            )
                        )
                loaded.append(skill_id)
                continue
            if not archive.exists():
                continue
            data = archive.read_bytes()
            expected = manifest.get(skill_id, {}).get("sha256")
            if expected and hashlib.sha256(data).hexdigest() != expected:
                raise ValueError(f"Skill checksum mismatch: {skill_id}")
            with zipfile.ZipFile(archive) as bundle:
                for entry in bundle.infolist():
                    # 不解压，限文件大小，只读取方法与参考资料。
                    if entry.file_size > 64_000 or not entry.filename.endswith(".md"):
                        continue
                    if not (
                        entry.filename.endswith("/SKILL.md") or "/references/" in entry.filename
                    ):
                        continue
                    text = bundle.read(entry).decode("utf-8-sig")
                    documents.append((f"skill:{skill_id}/{entry.filename}", text))
            loaded.append(skill_id)
        for folder, label in [(KNOWLEDGE, "builtin"), (self.root / "knowledge", "custom")]:
            for path in sorted(folder.glob("*.md")):
                if path.stat().st_size <= 64_000:
                    documents.append((f"knowledge:{label}/{path.stem}", path.read_text("utf-8")))
        query_tokens = tokens(query)
        chunks = []
        for source_id, text in documents:
            title = next(
                (s.lstrip("# ") for s in text.splitlines() if s.startswith("# ")), source_id
            )
            for i in range(0, len(text), 1200):
                chunk = text[i : i + 1400]
                score = len(query_tokens & tokens(chunk))
                if score or source_id.startswith("knowledge:") or "/SKILL.md" in source_id:
                    chunks.append((score, source_id, title, chunk))
        chunks.sort(key=lambda row: row[0], reverse=True)
        sources = {}
        excerpts = []
        for _, source_id, title, chunk in chunks[:8]:
            sources[source_id] = Source(id=source_id, title=title)
            excerpts.append(f"[{source_id}]\n{chunk}")
        # 给外部知识预留独立预算，不能被长 Skill 正文挤出上下文。
        hits = self.knowledge.search(platform, query)
        knowledge = []
        for hit in hits:
            sources[hit.source.id] = hit.source
            knowledge.append(f"[{hit.source.id}] {hit.source.title}\n{hit.text}")
        instructions = [text[:9000] for sid, text in documents if "/SKILL.md" in sid]
        skill_context = "\n\n".join(instructions + excerpts)[:17000]
        knowledge_context = "\n\n".join(knowledge)[:6000]
        return (
            loaded,
            list(sources.values()),
            skill_context + "\n\n平台知识参考：\n" + knowledge_context,
        )
