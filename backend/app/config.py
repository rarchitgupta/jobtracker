from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://jobtracker:jobtracker@localhost:5432/jobtracker"
    allowed_extension_origins: list[str] = []
    clerk_jwks_url: str = ""
    clerk_secret_key: str = ""
    clerk_webhook_secret: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
