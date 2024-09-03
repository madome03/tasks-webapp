from core.logger import get_logger 
from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Query
from fastapi.responses import JSONResponse
from typing import List, Optional
from app.services import companyService, authService
from app.models.company import Company, CompanyCreate, CompanyUpdate, Location, CompanyResponse

logger = get_logger(__name__)
router = APIRouter(prefix="/api/v1/companies", tags=["companies"])

@router.post("", response_model=CompanyResponse)
async def create_company(
    company: CompanyCreate,
    logo: Optional[UploadFile] = File(None),
    current_user: dict = Depends(authService.get_current_user)
):
    logger.info(f"Create company request received from user: {current_user['username']}")
    if not authService.is_super_admin(current_user):
        logger.warning(f"Unauthorized attempt to create company by user: {current_user['username']}")
        raise HTTPException(status_code=403, detail="Only super admins can create companies")
    try:
        return await companyService.create_company(company, logo)
    except ValueError as e:
        logger.error(f"Invalid input for company creation: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating company: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{company_id}", response_model=CompanyResponse)
async def get_company(
    company_id: int,
    current_user: dict = Depends(authService.get_current_user)
):
    logger.info(f"Get company request received for company ID: {company_id} from user: {current_user['username']}")
    if not authService.can_access_company(current_user, company_id):
        logger.warning(f"Unauthorized attempt to access company {company_id} by user: {current_user['username']}")
        raise HTTPException(status_code=403, detail="Not authorized to access this company")
    try:
        return await companyService.get_company(company_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{company_id}", response_model=CompanyResponse)
async def update_company(
    company_id: int,
    company_update: CompanyUpdate,
    current_user: dict = Depends(authService.get_current_user)
):
    logger.info(f"Update company request received for company ID: {company_id} from user: {current_user['username']}")
    if not authService.is_super_admin(current_user):
        logger.warning(f"Unauthorized attempt to update company {company_id} by user: {current_user['username']}")
        raise HTTPException(status_code=403, detail="Only super admins can update companies")
    try:
        return await companyService.update_company(company_id, company_update)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{company_id}/locations", response_model=Location)
async def add_location(
    company_id: int,
    location: Location,
    current_user: dict = Depends(authService.get_current_user)
):
    logger.info(f"Add location request received for company ID: {company_id} from user: {current_user['username']}")
    if not authService.is_super_admin(current_user):
        logger.warning(f"Unauthorized attempt to add location to company {company_id} by user: {current_user['username']}")
        raise HTTPException(status_code=403, detail="Only super admins can add locations")
    try:
        return await companyService.add_location(company_id, location)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding location to company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{company_id}/locations/{location_id}", response_model=Location)
async def update_location(
    company_id: int,
    location_id: int,
    location: Location,
    current_user: dict = Depends(authService.get_current_user)
):
    logger.info(f"Update location request received for company ID: {company_id}, location ID: {location_id} from user: {current_user['username']}")
    if not authService.is_super_admin(current_user):
        logger.warning(f"Unauthorized attempt to update location {location_id} of company {company_id} by user: {current_user['username']}")
        raise HTTPException(status_code=403, detail="Only super admins can update locations")
    try:
        return await companyService.update_location(company_id, location_id, location)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating location {location_id} of company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{company_id}/locations/{location_id}")
async def delete_location(
    company_id: int,
    location_id: int,
    current_user: dict = Depends(authService.get_current_user)
):
    logger.info(f"Delete location request received for company ID: {company_id}, location ID: {location_id} from user: {current_user['username']}")
    if not authService.is_super_admin(current_user):
        logger.warning(f"Unauthorized attempt to delete location {location_id} of company {company_id} by user: {current_user['username']}")
        raise HTTPException(status_code=403, detail="Only super admins can delete locations")
    try:
        await companyService.delete_location(company_id, location_id)
        return JSONResponse(content={"message": "Location deleted successfully"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting location {location_id} of company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{company_id}/logo")
async def update_company_logo(
    company_id: int,
    logo: UploadFile = File(...),
    current_user: dict = Depends(authService.get_current_user)
):
    logger.info(f"Update company logo request received for company ID: {company_id} from user: {current_user['username']}")
    if not authService.is_super_admin(current_user):
        logger.warning(f"Unauthorized attempt to update company logo for company {company_id} by user: {current_user['username']}")
        raise HTTPException(status_code=403, detail="Only super admins can update company logos")
    try:
        logo_url = await companyService.upload_logo(company_id, logo)
        logger.info(f"Logo updated successfully for company {company_id}")
        return JSONResponse(content={"message": "Logo updated successfully", "logo_url": logo_url})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating logo for company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("", response_model=List[CompanyResponse])
async def list_companies(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: dict = Depends(authService.get_current_user)
):
    logger.info(f"List companies request received from user: {current_user['username']}")
    if not authService.is_super_admin(current_user):
        logger.warning(f"Unauthorized attempt to list all companies by user: {current_user['username']}")
        raise HTTPException(status_code=403, detail="Only super admins can list all companies")
    try:
        return await companyService.list_companies(skip, limit)
    except Exception as e:
        logger.error(f"Error listing companies: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))