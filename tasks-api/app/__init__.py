from fastapi import FastAPI

app = FastAPI()

from app.api import companyManagement

# Add routes
app.include_router(companyManagement.router)