import { initializeBootstrap } from './bootstrap';

/**
 * Refreshes the collection list by querying the registry and rendering
 * all instances, or showing a placeholder if the registry is empty.
 */
async function refreshCollectionList(): Promise<void> {
  const { registry } = await initializeBootstrap();
  const collectionList = document.getElementById('collection-list');
  const emptyPlaceholder = document.getElementById('collection-list-empty');

  if (!collectionList) {
    return;
  }

  // Clear the list
  collectionList.innerHTML = '';

  // Get all collection instances from the registry
  const collections = await registry.list();

  if (collections.length === 0) {
    // Show placeholder
    if (emptyPlaceholder) {
      emptyPlaceholder.classList.remove('hidden');
    }
    collectionList.classList.add('hidden');
  } else {
    // Render the list
    if (emptyPlaceholder) {
      emptyPlaceholder.classList.add('hidden');
    }
    collectionList.classList.remove('hidden');

    collections.forEach((collection) => {
      const listItem = document.createElement('li');
      const link = document.createElement('a');
      link.href = `./collection?id=${collection.id}`;
      link.textContent = collection.name;
      listItem.appendChild(link);
      collectionList.appendChild(listItem);
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initial load
  await refreshCollectionList();

  // Wire up "Add New Collection" button
  const addButton = document.getElementById('add-collection-button');
  if (addButton) {
    addButton.addEventListener('click', () => {
      // Navigate to collection.pug in create mode
      window.location.href = './collection?mode=create';
    });
  }
});

// Auto-refresh the list when the page regains focus (user returns from collection page)
window.addEventListener('focus', async () => {
  await refreshCollectionList();
});