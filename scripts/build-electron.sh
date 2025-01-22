#!/usr/bin/env bash

# This script builds the electron app for mac, linux and windows. It performs
# the prebuild steps to build the frontend and set up the self-contained python
# env to run the backend.

# Keep track of operating system and architecture the script is running on
HOST_OS=$(uname -s)
HOST_ARCH=$(uname -m)
if [[ "$HOST_OS" == "MINGW"* ]]
then
    HOST_OS="Windows"
fi

# For now, the target OS and ARCH must match the host!
TARGET_OS=$HOST_OS
TARGET_ARCH=$HOST_ARCH

# Parse command line args
help_str="Usage: $0 [options]
Options:
    -h, --help         Show this help message
    -w, --working-dir  The working directory for the build
    -f, --force        Force reinstall of open-webui in venv
    -c, --clean        Clean the working dir"
working_dir="electron-build"
force=0
clean=0
while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h)
            echo -e "$help_str"
            exit 0
            ;;
        --working-dir|-w)
            working_dir="$2"
            shift 2
            ;;
        --force|-f)
            force=1
            shift
            ;;
        --clean|-c)
            clean=1
            shift
            ;;
        *)
            echo "Invalid argument: $1" >&2
            echo -e "$help_str"
            exit 1
            ;;
    esac
    shift
done

## Setup #######################################################################

# Run from the base of the project
cd $(dirname ${BASH_SOURCE[0]})/..
source_dir=$PWD

# Set up electron build dir and clean it
mkdir -p $working_dir
if [ "$clean" == "1" ]
then
    rm -rf $working_dir/*
fi
cd $working_dir

## Backend #####################################################################
(
# NOTE: Run in a subshell so that system python is not modified for
#   electron-builder

# Look for a working conda install across platforms
conda_cmd=""
if command -v conda &>/dev/null; then
    conda_cmd="conda"
elif command -v conda.bat &>/dev/null; then
    conda_cmd="conda.bat"
fi

activate_cmd="$conda_cmd activate"

# Get a version of conda to create the standalone env
if [ "$conda_cmd" == "" ]; then
    echo "INSTALLING CONDA..."
    mkdir -p conda-tmp
    cd conda-tmp
    conda_artifact="Miniforge3-${HOST_OS}-${HOST_ARCH}"
    if [ "$HOST_OS" == "Windows" ]
    then
        conda_artifact="$conda_artifact.exe"
    else
        conda_artifact="$conda_artifact.sh"
    fi
    curl -L -O https://github.com/conda-forge/miniforge/releases/download/24.3.0-0/$conda_artifact
    chmod +x $conda_artifact
    ./$conda_artifact -b -p .conda
    cd ..
fi

# Create the standalone python 3.11 environment with everything copied in
if ! [ -d venv  ]; then
    echo "CREATING venv..."
    $conda_cmd create --yes python=3.11 -p venv --copy
fi
$activate_cmd $PWD/venv

# Install open-webui from the source dir. This will also build the frontend and
# bundle it with the python package.
if ! command -v open-webui &>/dev/null || [ "$force" == "1" ]; then
    echo "INSTALLING open-webui..."
    pip install $source_dir
fi

# Figure out what the PYTHONPATH will need to be relative to the path the venv
# will live in when installed.
python -c 'import sys, os;
path_val=",".join([os.path.relpath(x, os.getcwd()) for x in sys.path if x]);
print(path_val)' > pythonpath.env
)

## App #########################################################################

# Copy the app config over to the build dir
cp $source_dir/package*.json .
cp $source_dir/index.js ./index.js

# Install node dependencies
npm install

# Add the app icon
mkdir -p resources
cp ../static/favicon/web-app-manifest-512x512.png resources/icon.png

# Run the electron build
build_flag=""
if [ "$TARGET_OS" == "Darwin" ]
then
    build_flag="--macos"
elif [ "$TARGET_OS" == "Windows" ]
then
    build_flag="--windows"
else
    build_flag="--linux"
fi
./node_modules/.bin/electron-builder build $build_flag
