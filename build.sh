#!/usr/bin/env bash
# Render build script — runs during every deploy.
set -o errexit   # exit on error

pip install --upgrade pip
pip install -r requirements.txt

python manage.py collectstatic --noinput
python manage.py migrate

# Create superuser on first deploy (skips if user already exists)
if [ "$DJANGO_SUPERUSER_USERNAME" ]; then
    python manage.py createsuperuser --noinput || true
fi
