from django.core.files.storage import FileSystemStorage
from products.image_processor import upload_to_freeimage

class FreeImageHostStorage(FileSystemStorage):
    def _open(self, name, mode='rb'):
        if name.startswith('http://') or name.startswith('https://'):
            import requests
            from django.core.files.base import ContentFile
            response = requests.get(name)
            response.raise_for_status()
            return ContentFile(response.content)
        return super()._open(name, mode)

    def _save(self, name, content):
        content.seek(0)
        image_bytes = content.read()
        url = upload_to_freeimage(image_bytes, filename=name)
        return url

    def url(self, name):
        if name.startswith('http://') or name.startswith('https://'):
            return name
        return super().url(name)

    def path(self, name):
        if name.startswith('http://') or name.startswith('https://'):
            raise NotImplementedError("This storage does not support absolute paths for remote files.")
        return super().path(name)

    def exists(self, name):
        if name.startswith('http://') or name.startswith('https://'):
            return False
        return super().exists(name)
