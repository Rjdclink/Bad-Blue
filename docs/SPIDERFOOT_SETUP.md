# SpiderFoot Setup (Optional)

## Quick Install

```bash
git clone https://github.com/smicallef/spiderfoot.git /opt/spiderfoot
cd /opt/spiderfoot
pip3 install -r requirements.txt
python3 sf.py -l 127.0.0.1:5001
```

## Docker (Easier)

```bash
docker run -p 5001:5001 spiderfoot/spiderfoot
```

## Add to .env

```bash
SPIDERFOOT_URL=http://localhost:5001
```

## Test

```bash
curl http://localhost:5001/api/version
```

SpiderFoot provides 200+ modules including:
- HaveIBeenPwned breach data
- Social media discovery
- Email pattern finding
- WHOIS lookups
- DNS records
