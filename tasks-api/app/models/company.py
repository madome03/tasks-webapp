from pydantic import BaseModel, HttpUrl
from typing import List, Optional

class Location(BaseModel):
    name: str
    address: str

class CompanyBase(BaseModel):
    name: str

class CompanyCreate(CompanyBase):
    locations: List[Location]

class CompanyUpdate(CompanyBase):
    logo_url: Optional[HttpUrl] = None

class Company(CompanyBase):
    id: int
    logo_url: Optional[HttpUrl] = None
    locations: List[Location]

    class Config:
        orm_mode = True

class CompanyResponse(Company):
    pass

# Add more models as needed for specific operations