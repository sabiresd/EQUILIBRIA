"""Configuration centrale — tout vient de l'environnement (.env)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "GridBalance AI Morocco"
    environment: str = "development"

    # --- Workflows de la plateforme agentique ----------------------------
    # Les 4 agents sont exposes en webhook POST par la plateforme (ABA Fusion /
    # Langflow). L'app ne connait qu'un POST HTTP et le contrat de contracts/.
    wf1_url: str = ""
    wf2_url: str = ""
    wf3_url: str = ""
    wf4_url: str = ""
    # stub : le backend simule les 4 agents en interne (la demo tourne hors ligne).
    # live : il appelle vraiment les webhooks ci-dessus.
    wf_mode: str = "stub"
    wf_timeout_seconds: int = 60
    wf_retries: int = 2

    # --- Securite --------------------------------------------------------
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_minutes: int = 15
    jwt_refresh_days: int = 7
    cookie_secure: bool = False
    cookie_domain: str | None = None
    rate_limit_per_minute: int = 30
    cors_origins: str = "http://localhost:3000"

    # OIDC : structure prete, desactive par defaut.
    oidc_enabled: bool = False
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""

    # --- Persistance -----------------------------------------------------
    # Vide ou "memory" -> base en memoire (aucune installation requise, donnees
    # perdues a l'arret). Sinon : mongodb://localhost:27017 ou une URI Atlas.
    mongo_url: str = "memory"
    mongo_db: str = "gridbalance"

    # --- E-mail ----------------------------------------------------------
    # file -> l'e-mail est ecrit dans backend/outbox/*.html (defaut en local)
    # smtp -> envoi reel via le serveur ci-dessous
    mail_mode: str = "file"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_from: str = "gridbalance@demo.ma"
    smtp_tls: bool = False

    slack_webhook_url: str = ""

    # --- Seuils d'alerte (modifiables depuis /admin) ---------------------
    # Calibres sur l'echelle du site de demo (besoin 6-15 MW) : le scenario
    # "windless" culmine a ~1.9 MW de deficit, le scenario "normal" a 0. Un seuil
    # de 1.5 MW distingue donc les deux, ce qu'un seuil a 5 MW ne ferait pas.
    alert_deficit_threshold_mw: float = 1.5
    alert_soc_threshold: float = 0.15

    app_public_url: str = "http://localhost:3000"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def workflow_urls(self) -> dict[str, str]:
        return {
            "WF1": self.wf1_url,
            "WF2": self.wf2_url,
            "WF3": self.wf3_url,
            "WF4": self.wf4_url,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
