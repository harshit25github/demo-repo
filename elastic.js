import { Client } from '@elastic/elasticsearch';

const client = new Client({
  node: 'http://localhost:9200',
  auth: {
    username: 'elastic',
    password: 'changeme'
  }
});

/**
 * Upload a single document without specifying an ID (Elasticsearch auto-generates one).
 */
async function uploadDocument(index: string, document: object) {
  try {
    const response = await client.index({
      index,
      document,
      refresh: 'wait_for'  // ensures it's searchable immediately
    });

    console.log(`✅ Document indexed with auto ID: ${response.body._id}`);
    return response;
  } catch (error) {
    console.error('❌ Error uploading document:', error.meta?.body || error);
  }
}

import { Client } from '@elastic/elasticsearch';

const client = new Client({
  node: 'http://localhost:9200',
  auth: {
    username: 'elastic',         // or from .env
    password: 'changeme'
  }
});

/**
 * Marks the document with given ID as processed (i.e., sets processed: true)
 */
async function markAsProcessed(index: string, docId: string) {
  try {
    const response = await client.update({
      index,
      id: docId,
      body: {
        doc: {
          processed: true
        }
      }
    });

    console.log(`✅ Document ${docId} updated as processed.`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to update document ${docId}:`, error.meta?.body || error);
  }
}



require('dotenv').config();
const fs = require('fs');
const { Client } = require('@elastic/elasticsearch');

// 1. Connect to Elasticsearch with basic auth
const client = new Client({
  node: process.env.ELASTIC_NODE, // e.g., 'http://localhost:9200'
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD
  }
});

// 2. Index name
const INDEX_NAME = 'courses';

// 3. Create index with optional mapping (optional)
async function createIndexIfNotExists() {
  const exists = await client.indices.exists({ index: INDEX_NAME });
  if (!exists.body) {
    await client.indices.create({
      index: INDEX_NAME,
      body: {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            title: { type: 'text' },
            published: { type: 'boolean' }
          }
        }
      }
    });
    console.log(`Index "${INDEX_NAME}" created.`);
  } else {
    console.log(`Index "${INDEX_NAME}" already exists.`);
  }
}

// 4. Load data.json and prepare bulk payload
function prepareBulkData(documents) {
  const body = [];

  for (const doc of documents) {
    body.push({
      index: { _index: INDEX_NAME, _id: doc.id }
    });
    body.push(doc);
  }

  return body;
}

// 5. Upload to Elasticsearch
async function uploadData() {
  try {
    await createIndexIfNotExists();

    const jsonData = fs.readFileSync('data.json', 'utf8');
    const documents = JSON.parse(jsonData);

    if (!Array.isArray(documents)) {
      throw new Error('JSON file must contain an array of documents.');
    }

    const bulkBody = prepareBulkData(documents);

    const { body } = await client.bulk({ refresh: true, body: bulkBody });

    if (body.errors) {
      console.error('Some documents failed to index:', body.items);
    } else {
      console.log(`✅ Successfully indexed ${documents.length} documents.`);
    }
  } catch (error) {
    console.error('❌ Error uploading data:', error);
  }
}

// Run
uploadData();
