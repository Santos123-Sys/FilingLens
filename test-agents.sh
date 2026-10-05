#!/bin/sh
# Test all 6 agents against the extracted filing text, timing each call.
TEXT=$(python3 -c "import json; print(json.dumps(json.load(open('/tmp/extract.json'))['text']))")
for AGENT in profiler market risks financials historian synthesizer; do
  START=$(date +%s)
  CODE=$(curl -s -o /tmp/agent-$AGENT.json -w "%{http_code}" -X POST http://localhost:3100/api/agent \
    -H "Content-Type: application/json" \
    -d "{\"agent\":\"$AGENT\",\"market\":\"us\",\"text\":$TEXT}")
  DUR=$(( $(date +%s) - START ))
  SIZE=$(wc -c < /tmp/agent-$AGENT.json)
  echo "$AGENT: HTTP $CODE in ${DUR}s (${SIZE} bytes)"
done
