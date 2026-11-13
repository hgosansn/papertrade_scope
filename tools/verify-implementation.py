"""Read-only HyperEVM evidence capture. No Papertrade app API or signing."""
import hashlib
import json
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "evidence" / "implementation-4e2a"
OUT.mkdir(parents=True, exist_ok=True)
EXCHANGE = "0x6cd5661646289fb6e65ea5c032310fded797d0a2"
IMPLEMENTATION = "0x4e2adafc40c734e9a8f96458b83ad62ad2b8a964"
SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
TOPICS = {
    "open": "0x88451ea1189f73b554f0bf39c09868560ed149b3d788fcc933ff66ba926827f3",
    "close": "0x87902ed2451849f465fc4d36a01d7f5c67b53af12f63ee85d2814a2d582f89bf",
    "liquidation": "0x0c859bc5db091ba3b9dc10c00f8dfc78b1f0b7e2566d107253ae67c069ae5de8",
}
session = requests.Session()
session.trust_env = False
last_call = 0


def rpc(method, params):
    global last_call
    time.sleep(max(0, 1.1 - (time.monotonic() - last_call)))
    last_call = time.monotonic()
    response = session.post("https://rpc.hyperliquid.xyz/evm", json={
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
    }, timeout=25)
    response.raise_for_status()
    value = response.json()
    if "error" in value:
        raise RuntimeError(value["error"])
    return value["result"]


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def pushes(code):
    data = bytes.fromhex(code.removeprefix("0x"))
    result = []
    pc = 0
    while pc < len(data):
        opcode = data[pc]
        size = opcode - 0x5f if 0x60 <= opcode <= 0x7f else 0
        if size:
            result.append({"pc": pc, "size": size, "data": data[pc+1:pc+1+size].hex()})
        pc += 1 + size
    return result


if __name__ == "__main__":
    head = rpc("eth_blockNumber", [])
    assert rpc("eth_chainId", []) == "0x3e7"
    slot = rpc("eth_getStorageAt", [EXCHANGE, SLOT, head])
    assert "0x" + slot[-40:] == IMPLEMENTATION
    code = rpc("eth_getCode", [IMPLEMENTATION, head])
    (OUT / "runtime.hex").write_text(code + "\n", encoding="utf-8")
    old_code = (ROOT / "evidence/open-source-abi/papertrade-recomp-post-upgrade-runtime.hex").read_text().strip()
    current_pushes, old_pushes = pushes(code), pushes(old_code)
    selectors = lambda items: sorted({p["data"] for p in items if p["size"] == 4})
    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(), "head": head,
        "implementation": IMPLEMENTATION, "implementationSlot": slot,
        "codeBytes": len(code[2:]) // 2,
        "sha256": hashlib.sha256(bytes.fromhex(code[2:])).hexdigest(),
        "removedPush4": sorted(set(selectors(old_pushes)) - set(selectors(current_pushes))),
        "addedPush4": sorted(set(selectors(current_pushes)) - set(selectors(old_pushes))),
        "exactPush32Topics": {k: any(p["data"] == topic[2:] for p in current_pushes) for k, topic in TOPICS.items()},
    }
    save("runtime-comparison.json", report)
    print(json.dumps(report), flush=True)
    logs = []
    for offset in range(0, 600, 200):
        end = int(head, 16) - offset
        logs += rpc("eth_getLogs", [{"address": EXCHANGE, "fromBlock": hex(end-199), "toBlock": hex(end)}])
    logs.sort(key=lambda l: (int(l["blockNumber"], 16), int(l["transactionIndex"], 16), int(l["logIndex"], 16)))
    save("logs.json", logs)
    print("Log topic counts", dict(Counter(l["topics"][0] for l in logs)), flush=True)
    selected = []
    for kind, topic in TOPICS.items():
        candidates = [l for l in logs if l["topics"][0] == topic]
        # Two distinct positions per event family; include both markets when observed.
        selected_ids = set()
        for log in reversed(candidates):
            position_id = int(log["topics"][1], 16)
            if position_id not in selected_ids:
                selected.append({"kind": kind, "log": log, "positionId": str(position_id)})
                selected_ids.add(position_id)
            if len(selected_ids) == 2:
                break
    receipts = {}
    for item in selected:
        log, position_id = item["log"], int(item["positionId"])
        tx = log["transactionHash"]
        if tx not in receipts:
            receipts[tx] = rpc("eth_getTransactionReceipt", [tx])
        item["receiptMatch"] = any(l["address"].lower() == EXCHANGE and l["logIndex"] == log["logIndex"] and l["data"] == log["data"] and l["topics"] == log["topics"] for l in receipts[tx]["logs"])
        assert item["receiptMatch"]
        block = log["blockNumber"]
        item["block"] = rpc("eth_getBlockByHash", [log["blockHash"], False])
        assert item["block"]["hash"] == log["blockHash"]
        item["implementationSlot"] = rpc("eth_getStorageAt", [EXCHANGE, SLOT, block])
        item["positionResponse"] = rpc("eth_call", [{"to": EXCHANGE, "data": "0x99fbab88" + f"{position_id:064x}"}, block])
        save("samples.json", selected)
        print("Verified receipt and captured position", item["kind"], item["positionId"], flush=True)
    save("receipts.json", receipts)
    getters = {}
    for name, data in {"collateralScale": "0xec0bdcfc", "instrument0": "0xdc8a47ef" + "0" * 64, "instrument1": "0xdc8a47ef" + f"{1:064x}"}.items():
        getters[name] = rpc("eth_call", [{"to": EXCHANGE, "data": data}, head])
    save("getters.json", getters)
    print("Captured", len(logs), "logs and", len(selected), "independently matched receipt/getter samples", flush=True)
