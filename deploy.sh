#!/bin/bash

# Set the root directory of your project
ROOT_DIR="/Users/adammansour/Projects/tasks-webapp"

# Set the paths to the tasks-api and tasks-infra directories
API_DIR="$ROOT_DIR/tasks-api"
INFRA_DIR="$ROOT_DIR/tasks-infra"

# Function to check the status of the last command
check_status() {
  if [ $? -ne 0 ]; then
    echo "Error: Deployment failed. Exiting."
    exit 1
  fi
}

# Navigate to the infrastructure directory
cd "$INFRA_DIR" || { echo "Error: Unable to navigate to $INFRA_DIR"; exit 1; }

# Deploy NetworkStack first
echo "Deploying NetworkStackForDatabase..."
npx cdk deploy --app "npx ts-node --prefer-ts-exts bin/tasks-infra.ts NetworkStack" 
check_status

# Deploy DatabaseStack next
echo "Deploying DatabaseStack..."
npx cdk deploy --app "npx ts-node --prefer-ts-exts bin/tasks-infra.ts DatabaseStack" --all
check_status

# Deploy LambdaStack after DatabaseStack
echo "Deploying LambdaStack..."
npx cdk deploy --app "npx ts-node --prefer-ts-exts bin/tasks-infra.ts LambdaStack" --all
check_status

# Deploy CognitoStack after LambdaStack
echo "Deploying CognitoStack..."
npx cdk deploy --app "npx ts-node --prefer-ts-exts bin/tasks-infra.ts CognitoStack" --all
check_status

# Deploy ApiGatewayStack after CognitoStack
echo "Deploying ApiGatewayStack..."
npx cdk deploy --app "npx ts-node --prefer-ts-exts bin/tasks-infra.ts ApiGatewayStack" --all
check_status

# If all deployments succeed
echo "All stacks deployed successfully!"
