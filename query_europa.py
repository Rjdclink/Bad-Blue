import urllib.request
import json
import sys

URL = "https://mainnet.skalenodes.com/v1/europa"

def json_rpc(method, params=[]):
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as response:
        res = json.loads(response.read().decode('utf-8'))
        if 'error' in res:
            raise Exception(f"RPC Error: {res['error']}")
        return res['result']

def main():
    print("Fetching latest block number...")
    latest_hex = json_rpc("eth_blockNumber")
    latest = int(latest_hex, 16)
    print(f"Latest Block: {latest} ({latest_hex})")

    found_tx = None
    # Inspect up to last 100 blocks
    for i in range(100):
        block_num = latest - i
        block_hex = hex(block_num)
        # print(f"Checking block {block_num}...", end='\r')
        block = json_rpc("eth_getBlockByNumber", [block_hex, False])
        if block and block.get("transactions"):
            txs = block["transactions"]
            if len(txs) > 0:
                print(f"\nFound {len(txs)} transactions in block {block_num} ({block_hex})")
                found_tx = txs[0]
                break
    
    if not found_tx:
        print("\nNo transactions found in the last 100 blocks.")
        return

    print(f"First tx hash found: {found_tx}")

    # Fetch tx details and receipt
    tx_details = json_rpc("eth_getTransactionByHash", [found_tx])
    tx_receipt = json_rpc("eth_getTransactionReceipt", [found_tx])

    print("\n--- Tx Details ---")
    print(json.dumps(tx_details, indent=2))
    print("\n--- Tx Receipt ---")
    print(json.dumps(tx_receipt, indent=2))

    # Log specific fields
    block_num_tx = tx_details.get("blockNumber")
    tx_type = tx_details.get("type")
    gas_price = tx_details.get("gasPrice")
    max_fee_per_gas = tx_details.get("maxFeePerGas")
    
    effective_gas_price = tx_receipt.get("effectiveGasPrice")
    gas_used = tx_receipt.get("gasUsed")
    from_addr = tx_receipt.get("from")
    to_addr = tx_receipt.get("to")
    status = tx_receipt.get("status")

    print("\n--- Summary of Requested Fields ---")
    print(f"Block Number: {block_num_tx} ({int(block_num_tx, 16) if block_num_tx else 'None'})")
    print(f"Tx Type: {tx_type} ({int(tx_type, 16) if tx_type else 'None'})")
    print(f"gasPrice: {gas_price} ({int(gas_price, 16) if gas_price else 'None'})")
    print(f"maxFeePerGas: {max_fee_per_gas} ({int(max_fee_per_gas, 16) if max_fee_per_gas else 'None'})")
    print(f"effectiveGasPrice: {effective_gas_price} ({int(effective_gas_price, 16) if effective_gas_price else 'None'})")
    print(f"gasUsed: {gas_used} ({int(gas_used, 16) if gas_used else 'None'})")
    print(f"from: {from_addr}")
    print(f"to: {to_addr}")
    print(f"status: {status} ({int(status, 16) if status else 'None'})")

if __name__ == "__main__":
    main()
