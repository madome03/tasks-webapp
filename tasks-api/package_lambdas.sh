#!/bin/bash

# Function to package a Lambda
package_lambda() {
    local source_dir=$1
    local requirements_file=$2
    local output_zip=$3

    echo "Packaging $output_zip..."
    
    # Create a temporary directory for packaging
    mkdir -p temp_package

    # Copy the Lambda function code
    cp $source_dir/*.py temp_package/

    # Install dependencies
    pip install -r $requirements_file -t temp_package/

    # Create the zip file
    cd temp_package
    zip -r ../$output_zip .
    cd ..

    # Clean up
    rm -rf temp_package

    echo "$output_zip packaged successfully"
}

# Package the main backend Lambda
package_lambda "backend" "backend/requirements.txt" "lambda_backend.zip"

# Package the DB initialization Lambda
package_lambda "db_init_lambda" "db_init_lambda/requirements.txt" "lambda_db_init.zip"

# Copy the SQL file into the db_init Lambda package
zip -j lambda_db_init.zip db_init_lambda/migrations/V1__initial_schema.sql

echo "All Lambda functions packaged successfully"