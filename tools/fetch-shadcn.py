"""Refresh the vendored shadcn/ui primitives from the official registry."""
import json
import sys
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ["button", "switch", "slider", "popover", "sheet", "dialog", "separator", "input", "badge", "tooltip", "select"]
session = requests.Session()
session.trust_env = False
package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
provenance_path = ROOT / "src/components/ui/provenance.json"
sources = json.loads(provenance_path.read_text(encoding="utf-8")) if provenance_path.exists() else []
selected = sys.argv[1:] or COMPONENTS
for name in selected:
    url = f"https://ui.shadcn.com/r/styles/new-york/{name}.json"
    response = session.get(url, timeout=30)
    response.raise_for_status()
    item = response.json()
    for dependency in item.get("dependencies", []):
        package["dependencies"][dependency] = "latest"
    for file in item["files"]:
        target = ROOT / "src/components/ui" / Path(file["path"]).name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(file["content"], encoding="utf-8")
    sources = [source for source in sources if source["component"] != name]
    sources.append({"component": name, "source": url})
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
license_response = session.get("https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md", timeout=30)
license_response.raise_for_status()
(ROOT / "LICENSES/shadcn-ui-MIT.txt").write_text(license_response.text, encoding="utf-8")
(ROOT / "src/components/ui/provenance.json").write_text(json.dumps(sources, indent=2) + "\n", encoding="utf-8")
print(f"Vendored {len(selected)} official shadcn/ui components.")
