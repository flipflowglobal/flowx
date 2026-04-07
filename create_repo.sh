#!/bin/bash

# Navigate into the project workspace
cd /home/ubuntu/project_workspace

# Remove any existing .git directory from the main project to re-initialize
rm -rf .git

# Remove .git directory from Jdltrade if it exists to avoid embedded repository issues
if [ -d "Jdltrade/.git" ]; then
    rm -rf Jdltrade/.git
fi

# Remove .git directory from nexus-core if it exists to avoid embedded repository issues
if [ -d "nexus-core/.git" ]; then
    rm -rf nexus-core/.git
fi

# Initialize a new Git repository locally
git init

# Set the default branch to main
git branch -M main

# Add all relevant project files to the repository
git add .

# Commit the files
git commit -m "Initial commit of NEXUS-ARB v2.0 production-ready system with Rust core (compilation issues present)"

# Add the remote repository
git remote add origin https://github.com/flipflowglobal/nexus-arbitrage.git

# Push the files to the new repository
git push -u origin main
