from setuptools import setup, find_packages
import pathlib

# Get the directory containing this file
here = pathlib.Path(__file__).parent

# Read the long description from the README file (if it exists)
readme_file = here / "README.md"
long_description = readme_file.read_text(encoding="utf-8") if readme_file.exists() else ""

setup(
    name="your-package-name",
    version="0.1.0",
    description="A short description of your package.",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Your Name",
    author_email="you@example.com",
    url="https://github.com/yourusername/yourrepo",
    license="MIT",
    packages=find_packages(exclude=("tests", "docs")),
    python_requires=">=3.8",
    install_requires=[
        # List your package dependencies here
        # e.g. "requests>=2.25.0",
    ],
    entry_points={
        # If you have console scripts, add them here
        # "console_scripts": [
        #     "yourcommand=yourpackage.module:main",
        # ],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    project_urls={
        "Bug Tracker": "https://github.com/yourusername/yourrepo/issues",
    },
    include_package_data=True,
    zip_safe=False,
)