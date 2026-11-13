"""Hash staged publication files using their Git-normalized bytes."""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
files = []
for name in sorted(filter(None, paths)):
    if name == "manifest.json":
        continue
    data = subprocess.check_output(["git", "show", f":{name}"], cwd=root)
    files.append({"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
(root / "manifest.json").write_text(json.dumps({
    "version": package["version"], "publication": "papertrade_scope", "product": "Paperscope",
    "hashBasis": "Git-normalized staged file bytes; manifest excludes itself", "files": files,
}, indent=2) + "\n", encoding="utf-8")
print(f"Hashed {len(files)} publication files for Paperscope {package['version']}.")
