from fastapi import FastAPI
from app.api import companyManagement, userManagement, tasks

app = FastAPI()

app.include_router(companyManagement.router, prefix="/companies", tags=["companies"])
app.include_router(userManagement.router, prefix="/users", tags=["users"])
app.include_router(tasks.router, prefix="/tasks", tags=["tasks"])

@app.get("/")
async def root():
    return {"message": "Welcome to the Tasks API"}