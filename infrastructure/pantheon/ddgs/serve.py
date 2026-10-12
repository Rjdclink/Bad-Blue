"""Serve health checks and private-network traffic on the same PORT."""
import os
import socket

import uvicorn


def main():
    port = int(os.environ.get("PORT", "4479"))
    if socket.has_dualstack_ipv6():
        listener = socket.create_server(("::", port), family=socket.AF_INET6, dualstack_ipv6=True)
    else:
        listener = socket.create_server(("0.0.0.0", port))
    with listener:
        config = uvicorn.Config("ddgs.api_server:fastapi_app", log_level="info", access_log=False)
        uvicorn.Server(config).run(sockets=[listener])


if __name__ == "__main__":
    main()
