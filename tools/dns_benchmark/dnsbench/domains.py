"""Test domain lists (configurable in Settings).

* ``POPULAR`` — high-traffic sites spread across many CDNs and DNS hosts, so no single provider or CDN is
  favoured. These answers are almost always already cached by a busy resolver: they measure what you feel
  when browsing.
* ``GAMING`` — game platforms, launchers, login and voice services.
* ``UNCACHED_ZONES`` — zones we append a unique random label to (``k3j9…​.wikipedia.org``). Nobody has ever
  asked for that exact name, so the resolver must contact the zone's authoritative servers: this measures
  cache-miss performance. The zones were chosen because they answer random names with a plain NXDOMAIN (no
  wildcard) and are hosted by different DNS operators.
"""

from __future__ import annotations

import random
import re
import string

POPULAR = [
    "google.com", "youtube.com", "microsoft.com", "apple.com", "amazon.co.uk", "bbc.co.uk", "reddit.com",
    "github.com", "cloudflare.com", "wikipedia.org", "steamcommunity.com", "steampowered.com", "discord.com",
    "twitch.tv", "netflix.com",
    # extra variety (different CDNs / DNS operators)
    "facebook.com", "instagram.com", "whatsapp.com", "linkedin.com", "spotify.com", "zoom.us", "office.com",
    "outlook.com", "paypal.com", "ebay.co.uk", "yahoo.com", "x.com", "tiktok.com", "theguardian.com",
    "gov.uk", "akamai.com", "fastly.com",
]

GAMING = [
    "steampowered.com", "steamcommunity.com", "api.steampowered.com", "epicgames.com", "riotgames.com",
    "battle.net", "ea.com", "ubisoft.com", "xboxlive.com", "playstation.net", "nintendo.com", "roblox.com",
    "minecraft.net", "rockstargames.com", "discord.com", "twitch.tv", "faceit.com",
]

UNCACHED_ZONES = [
    "google.com", "microsoft.com", "amazon.com", "wikipedia.org", "bbc.co.uk", "yahoo.com", "akamai.com",
    "mozilla.org", "spotify.com",
]

_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")


def normalise_domain(name: str) -> str | None:
    """Return a cleaned lowercase hostname, or None if it isn't a valid domain name."""
    name = name.strip().lower().rstrip(".")
    name = re.sub(r"^[a-z]+://", "", name).split("/", 1)[0]
    if not name or len(name) > 253 or "." not in name:
        return None
    try:
        name = name.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    if all(_LABEL.match(label) for label in name.split(".")):
        return name
    return None


def parse_domain_list(text: str) -> tuple[list[str], list[str]]:
    """Parse a user-edited list (one per line, commas OK, # comments). Returns (valid, rejected)."""
    valid: list[str] = []
    rejected: list[str] = []
    for raw in re.split(r"[\n,;]+", text):
        raw = raw.split("#", 1)[0].strip()
        if not raw:
            continue
        d = normalise_domain(raw)
        if d is None:
            rejected.append(raw)
        elif d not in valid:
            valid.append(d)
    return valid, rejected


def random_label(rng: random.Random, length: int = 14) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "dnsb" + "".join(rng.choice(alphabet) for _ in range(length - 4))


def uncached_name(zone: str, rng: random.Random) -> str:
    return f"{random_label(rng)}.{zone}"
