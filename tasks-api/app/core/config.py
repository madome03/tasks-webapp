import os
from pydantic import BaseSettings

class Settings(BaseSettings):
    # Project info
    PROJECT_NAME: str = "Task Management System"
    PROJECT_VERSION: str = "1.0.0"

    # AWS configurations
    AWS_REGION: str = os.getenv("AWS_REGION", "us-east-1")
    COMPANY_LOGOS_BUCKET: str = os.getenv("COMPANY_LOGOS_BUCKET")

    # Database configurations
    DB_SECRET_ARN: str = os.environ("DB_SECRET_ARN")
    DB_NAME: str = os.environ("DB_NAME")

    # Cognito configurations
    COGNITO_USER_POOL_ID: str = os.getenv("COGNITO_USER_POOL_ID")
    COGNITO_APP_CLIENT_ID: str = os.getenv("COGNITO_APP_CLIENT_ID")

    # API configurations
    API_V1_STR: str = "/api/v1"
    
    # Security configurations
    SECRET_KEY: str = os.getenv("SECRET_KEY", "your-secret-key")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    class Config:
        case_sensitive = True

settings = Settings()