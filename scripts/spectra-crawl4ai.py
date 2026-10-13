"""Local Crawl4AI extraction of HTML already admitted by Spectra's URL policy.

One bounded stdin request, one JSON response. No network, browser, LLM or signup.
"""
import contextlib
import io
import json
import sys


def extract(payload):
    from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
    html = payload["html"]
    if not isinstance(html, str) or len(html.encode("utf-8")) > 2_000_000:
        raise ValueError("Invalid input")
    result = DefaultMarkdownGenerator(options={"ignore_images": True, "body_width": 0}).generate_markdown(
        input_html=html, base_url=payload["url"], citations=False
    )
    return {"markdown": result.raw_markdown[:320_000]}


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(4_000_001)
        if len(raw) > 4_000_000:
            raise ValueError("Input too large")
        # Libraries must not interleave logs with the JSON protocol.
        with contextlib.redirect_stdout(io.StringIO()):
            result = extract(json.loads(raw))
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Never emit input, upstream content, URLs or stack traces.
        sys.exit(1)
