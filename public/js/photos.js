// Photos are optional, limited in size, and saved by the server with random names.
const maxSize = 2 * 1024 * 1024;
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
let previewURLs = [];

function validateFiles(input) {
  const files = [...input.files];
  if (files.length > 3) throw new Error('Choose at most 3 photos.');
  for (const file of files) {
    if (!allowedTypes.includes(file.type)) throw new Error('Use JPEG, PNG or WebP photos.');
    if (file.size > maxSize) throw new Error('Each photo must be 2 MB or smaller.');
  }
  return files;
}

export function clearPhotoPreview() {
  previewURLs.forEach((url) => URL.revokeObjectURL(url));
  previewURLs = [];
  document.querySelector('#photo-preview').replaceChildren();
}

export function showPhotoPreview(input) {
  clearPhotoPreview();
  const files = validateFiles(input);
  for (const file of files) {
    const url = URL.createObjectURL(file);
    previewURLs.push(url);
    const image = document.createElement('img');
    image.src = url;
    image.alt = `Selected photo: ${file.name}`;
    document.querySelector('#photo-preview').append(image);
  }
}

export function readPhotos(input) {
  return Promise.all(
    validateFiles(input).map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () =>
            reject(new Error('Could not read this photo. Please select it again.'));
          reader.readAsDataURL(file);
        }),
    ),
  );
}

export function photoURL(filename) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(filename)) return '';
  return new URL(`../../photos/${filename}`, import.meta.url).href;
}
