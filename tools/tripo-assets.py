"""通过 Tripo v3 离线生成建筑资产，不向浏览器提供 API 密钥。

配置 TRIPO_API_KEY（tsk_ 开头）后使用：
  python tools/tripo-assets.py --region ov --levels 1 2 3 4 5
  python tools/tripo-assets.py --region cn --levels 1 --submit-only
再次运行会复用已保存的任务 ID；不会自动重试创建收费任务。
"""
import argparse
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description="从已确认的透明底建筑图生成 Tripo GLB")
    parser.add_argument("--region", required=True, choices=["ov", "cn"])
    parser.add_argument("--levels", nargs="+", type=int, choices=range(1, 6), default=[1])
    parser.add_argument("--submit-only", action="store_true")
    parser.add_argument("--quality", choices=["detailed", "draft"], default="detailed")
    args = parser.parse_args()
    key = os.environ.get("TRIPO_API_KEY", "")
    if not key.startswith("tsk_"):
        sys.exit("请在 TRIPO_API_KEY 中配置 tsk_ 开头的 API Key；tcli_ 是 Client ID。")
    domain = "openapi.tripo3d.ai" if args.region == "ov" else "openapi.tripo3d.com"
    base = f"https://{domain}/v3"
    output = ROOT / "assets" / "models"
    output.mkdir(parents=True, exist_ok=True)
    jobs_path = output / "tripo-jobs.json"
    jobs = json.loads(jobs_path.read_text("utf-8")) if jobs_path.exists() else {}
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8"))

    def request(endpoint, data=None, content_type="application/json"):
        headers = {"Authorization": f"Bearer {key}", "Content-Type": content_type}
        req = urllib.request.Request(base + endpoint, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            # 不回显请求头、凭证、响应正文或用户身份。
            raise RuntimeError(f"Tripo HTTP {error.code}；未自动重试创建任务") from None
        if result.get("code") != 0:
            raise RuntimeError(f"Tripo 返回错误码 {result.get('code')}；请在平台查看详情")
        return result.get("data", {})

    for level in dict.fromkeys(args.levels):
        job_key = f"{args.region}:shop-{level}" + (":detailed" if args.quality == "detailed" else "")
        job = jobs.get(job_key)
        if not job:
            source = ROOT / "assets" / "game" / f"shop-{level}.png"
            boundary = "----emc-" + secrets.token_hex(12)
            payload = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
                       f"filename=\"shop-{level}.png\"\r\nContent-Type: image/png\r\n\r\n").encode()
            payload += source.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
            uploaded = request("/files", payload, f"multipart/form-data; boundary={boundary}")
            token = uploaded.get("file_token")
            if not token:
                raise RuntimeError("上传返回缺少 file_token，未提交生成")
            params = {"input": token, "texture": True, "pbr": True, "auto_size": True}
            if args.quality == "detailed":
                params.update(model="v3.1-20260211", face_limit=50000,
                              geometry_quality="detailed", texture_quality="detailed",
                              texture_version="v3.5-20260815", texture_alignment="original_image", delight=True)
            else:
                params.update(model="P1-20260311", face_limit=8000)
            task = request("/generation/image-to-model", json.dumps(params).encode())
            job = {"task_id": task["task_id"], "status": "submitted"}
            jobs[job_key] = job
            jobs_path.write_text(json.dumps(jobs, indent=2), "utf-8")
        print(f"shop-{level}: {job['task_id']}", flush=True)
        if args.submit_only:
            continue
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline:
            task = request("/tasks/" + job["task_id"])
            status = task.get("status")
            if status == "success":
                generated = task.get("output", {})
                # v3 统一 model_url；兼容本机曾记录的 v2 任务输出。
                model = generated.get("model_url") or generated.get("pbr_model") or generated.get("model")
                model_url = model.get("url") if isinstance(model, dict) else model
                if not isinstance(model_url, str) or not model_url.startswith("https://"):
                    raise RuntimeError("任务成功但未发现可下载的 HTTPS GLB 地址，请检查任务输出")
                # 使用独立候选文件，避免未检查的结果覆盖正在展示的模型。
                local = output / f"shop-{level}-{job['task_id'][:8]}.glb"
                # CDN 下载不携带 API 凭证。
                with urllib.request.urlopen(model_url, timeout=120) as response:
                    local.write_bytes(response.read())
                if local.read_bytes()[:4] != b"glTF":
                    local.unlink()
                    raise RuntimeError("下载结果不是 GLB，已停止接入")
                job["status"] = "downloaded_pending_review"
                entry = manifest["shops"][str(level)]
                entry["candidate_url"] = f"assets/models/{local.name}"
                # 生成不等于可用：检查模型朝向、尺寸和墙面材质后，手动设为 model_url。
                manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
                jobs_path.write_text(json.dumps(jobs, indent=2), "utf-8")
                print(f"shop-{level}: 已下载，待检查材质与摆放锚点后启用", flush=True)
                break
            if status in {"failed", "cancelled", "canceled", "banned", "expired"}:
                raise RuntimeError(f"shop-{level}: {status}；保留任务 ID，不自动重复收费")
            time.sleep(5)
        else:
            raise RuntimeError("轮询超时，任务 ID 已保留；稍后运行同一命令继续查询")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as exc:
        sys.exit(str(exc))
