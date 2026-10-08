from typing import Optional
from supabase import create_client, Client
from src.config import config

_client: Optional[Client] = None


def get_supabase_client() -> Client:
    """Returns a singleton Supabase Client instance configured with project settings."""
    global _client
    if _client is None:
        if not config.SUPABASE_URL or not (config.SUPABASE_SERVICE_ROLE_KEY or config.SUPABASE_KEY):
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required in environment."
            )
        key = config.SUPABASE_SERVICE_ROLE_KEY or config.SUPABASE_KEY
        _client = create_client(config.SUPABASE_URL, key)
    return _client


# Lazy client proxy or helper
class _SupabaseProxy:
    def __getattr__(self, name):
        return getattr(get_supabase_client(), name)


supabase: Client = _SupabaseProxy()  # type: ignore
