from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./nodus.db"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    # Optional per-role overrides (fall back to llm_model)
    llm_debate_model: str = ""
    llm_graph_model: str = ""
    llm_moderator_model: str = ""
    llm_timeout_sec: float = 60.0
    # Safety cap for "Unlimited" discussions
    max_turns_safety_cap: int = 500
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def debate_model(self) -> str:
        return self.llm_debate_model or self.llm_model

    @property
    def graph_model(self) -> str:
        return self.llm_graph_model or self.llm_model

    @property
    def moderator_model(self) -> str:
        return self.llm_moderator_model or self.llm_model

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
