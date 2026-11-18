#!/usr/bin/env python3
"""Quiet guest-state auth noise:
- isRetryable: 401 is not retryable (the api layer already refreshes tokens
  internally; a surfaced 401 for a guest is permanent -> retry storm removed)
- useDailyMixes / useRecentlyPlayed: skip the /v1/me/* calls entirely for
  guests (no session -> upstream 401s them) and fall back to the existing
  guest data paths
"""
ROOT = "/home/z/my-project/liner-app"

RETRY_OLD = """  return (
    status === 0 ||
    status === 401 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );"""
RETRY_NEW = """  return (
    status === 0 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );"""

MIX_OLD = """    () =>
      loadWithRetry(
        () => api.getDailyMixes(),
        () => true,
      )
        .then((res) => toDailyMixes(res.items))
        .catch(() => [] as DailyMix[])
        .then((mixes) =>
          mixes.length > 0 ? mixes : loadInnertubeMixes(),
        ),"""
MIX_NEW = """    () =>
      // guests have no recommendations endpoint access — skip the guaranteed
      // 401 and go straight to the Innertube fallback mixes
      (owner
        ? loadWithRetry(
            () => api.getDailyMixes(),
            () => true,
          )
            .then((res) => toDailyMixes(res.items))
            .catch(() => [] as DailyMix[])
        : Promise.resolve([] as DailyMix[])
      ).then((mixes) =>
        mixes.length > 0 ? mixes : loadInnertubeMixes(),
      ),"""

RECENT_OLD = "    () => loadRecentlyPlayed(limit),"
RECENT_NEW = "    () => (owner ? loadRecentlyPlayed(limit) : Promise.resolve([])),"

for tree in ("src", "src-classic"):
    print(f"[{tree}]")
    p = f"{ROOT}/{tree}/features/home/hooks/sessionAwareLoad.ts"
    s = open(p, encoding="utf-8").read()
    assert RETRY_OLD in s, p
    open(p, "w", encoding="utf-8").write(s.replace(RETRY_OLD, RETRY_NEW, 1))
    print("  ok isRetryable")

    p = f"{ROOT}/{tree}/features/home/hooks/useDailyMixes.ts"
    s = open(p, encoding="utf-8").read()
    assert MIX_OLD in s, p
    open(p, "w", encoding="utf-8").write(s.replace(MIX_OLD, MIX_NEW, 1))
    print("  ok dailyMixes guard")

    p = f"{ROOT}/{tree}/features/home/hooks/useRecentlyPlayed.ts"
    s = open(p, encoding="utf-8").read()
    assert RECENT_OLD in s, p
    open(p, "w", encoding="utf-8").write(s.replace(RECENT_OLD, RECENT_NEW, 1))
    print("  ok recentlyPlayed guard")

print("DONE")
