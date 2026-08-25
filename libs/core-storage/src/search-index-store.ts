import { getDb } from './session-store';

export async function getSearchIndexBlob(): Promise<string | undefined> {
  const record = await getDb().searchIndex.get('default');
  return record?.json;
}

export async function putSearchIndexBlob(json: string): Promise<void> {
  await getDb().searchIndex.put({ id: 'default', json, updatedAt: Date.now() });
}
