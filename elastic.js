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
