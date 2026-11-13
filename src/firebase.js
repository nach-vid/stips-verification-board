const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let db = null;
let isMock = false;

/**
 * In-memory fallback database for local development without credentials
 */
function createMockFirestore() {
  console.log('[Firebase] Running in LOCAL DEVELOPMENT fallback mode (In-Memory database).');
  console.log('[Firebase] To connect to production Firestore, configure FIREBASE_SERVICE_ACCOUNT in your environment or .env file.');

  const store = {
    users: new Map(),
    pending_verifications: new Map(),
    messages: []
  };

  function getItems(collName) {
    let list = [];
    if (Array.isArray(store[collName])) {
      list = [...store[collName]];
    } else if (store[collName] instanceof Map) {
      list = Array.from(store[collName].values());
    }
    return list;
  }

  return {
    collection: (collName) => {
      return {
        doc: (docId) => {
          return {
            set: async (data, options = {}) => {
              if (!store[collName]) store[collName] = new Map();
              const existing = store[collName].get(docId) || {};
              const merged = options.merge ? { ...existing, ...data } : data;
              store[collName].set(docId, merged);
              return { id: docId };
            },
            get: async () => {
              if (!store[collName] || !store[collName].has(docId)) {
                return { exists: false, data: () => null };
              }
              return {
                exists: true,
                id: docId,
                data: () => store[collName].get(docId)
              };
            },
            delete: async () => {
              if (store[collName]) store[collName].delete(docId);
            }
          };
        },
        add: async (data) => {
          const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          const record = { id, ...data };
          if (!store[collName]) store[collName] = [];
          if (Array.isArray(store[collName])) {
            store[collName].push(record);
          } else {
            store[collName].set(id, record);
          }
          return { id };
        },
        where: (field, op, val) => {
          return {
            get: async () => {
              const list = getItems(collName).filter(item => {
                if (op === '==' || op === '===') return item[field] === val;
                if (op === '!=') return item[field] !== val;
                return true;
              });
              return {
                empty: list.length === 0,
                docs: list.map(item => ({
                  id: item.id,
                  data: () => item
                }))
              };
            },
            limit: (count) => {
              return {
                get: async () => {
                  const list = getItems(collName).filter(item => {
                    if (op === '==' || op === '===') return item[field] === val;
                    if (op === '!=') return item[field] !== val;
                    return true;
                  }).slice(0, count);
                  return {
                    empty: list.length === 0,
                    docs: list.map(item => ({
                      id: item.id,
                      data: () => item
                    }))
                  };
                }
              };
            }
          };
        },
        orderBy: (field, direction = 'asc') => {
          return {
            limit: (count) => {
              return {
                get: async () => {
                  let list = getItems(collName);
                  list.sort((a, b) => {
                    const valA = a[field] ? (a[field].toMillis ? a[field].toMillis() : new Date(a[field]).getTime()) : 0;
                    const valB = b[field] ? (b[field].toMillis ? b[field].toMillis() : new Date(b[field]).getTime()) : 0;
                    return direction === 'desc' ? valB - valA : valA - valB;
                  });

                  if (count) list = list.slice(0, count);

                  return {
                    empty: list.length === 0,
                    docs: list.map(item => ({
                      id: item.id,
                      data: () => item
                    }))
                  };
                }
              };
            },
            get: async () => {
              let list = getItems(collName);
              list.sort((a, b) => {
                const valA = a[field] ? (a[field].toMillis ? a[field].toMillis() : new Date(a[field]).getTime()) : 0;
                const valB = b[field] ? (b[field].toMillis ? b[field].toMillis() : new Date(b[field]).getTime()) : 0;
                return direction === 'desc' ? valB - valA : valA - valB;
              });

              return {
                empty: list.length === 0,
                docs: list.map(item => ({
                  id: item.id,
                  data: () => item
                }))
              };
            }
          };
        },
        get: async () => {
          let list = getItems(collName);
          return {
            empty: list.length === 0,
            docs: list.map(item => ({
              id: item.id,
              data: () => item
            }))
          };
        }
      };
    }
  };
}

/**
 * Initializes and returns the Firestore instance.
 * Priority order for credentials:
 * 1. process.env.FIREBASE_SERVICE_ACCOUNT (JSON string or base64 encoded)
 * 2. Individual env variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * 3. GOOGLE_APPLICATION_CREDENTIALS path
 * 4. Local serviceAccountKey.json file
 * 5. Default GCP/Firebase environment credentials
 * 6. Local In-Memory Fallback
 */
function initFirestore() {
  if (db) return db;

  // 1. Check FIREBASE_SERVICE_ACCOUNT (full JSON string or Base64 string from cloud platforms)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let rawJson = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      // Handle base64 encoded JSON string
      if (!rawJson.startsWith('{') && !rawJson.startsWith('"')) {
        try {
          rawJson = Buffer.from(rawJson, 'base64').toString('utf8');
        } catch (e) {
          // not base64, proceed with raw
        }
      }
      const serviceAccount = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      }
      db = admin.firestore();
      console.log(`[Firebase] Production Firestore initialized successfully via FIREBASE_SERVICE_ACCOUNT (Project: ${serviceAccount.project_id || 'cloud'}).`);
      return db;
    } catch (err) {
      console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
    }
  }

  // 2. Check individual environment variables
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    try {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey
          })
        });
      }
      db = admin.firestore();
      console.log(`[Firebase] Production Firestore initialized successfully via individual env variables (Project: ${process.env.FIREBASE_PROJECT_ID}).`);
      return db;
    } catch (err) {
      console.error('[Firebase] Error initializing Firebase with individual env variables:', err.message);
    }
  }

  // 3. Check GOOGLE_APPLICATION_CREDENTIALS file
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault()
        });
      }
      db = admin.firestore();
      console.log('[Firebase] Production Firestore initialized successfully via GOOGLE_APPLICATION_CREDENTIALS.');
      return db;
    } catch (err) {
      console.error('[Firebase] Error initializing Firebase with GOOGLE_APPLICATION_CREDENTIALS:', err.message);
    }
  }

  // 4. Check local serviceAccountKey.json file in project root
  const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = require(serviceAccountPath);
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      }
      db = admin.firestore();
      console.log(`[Firebase] Production Firestore initialized successfully via serviceAccountKey.json (Project: ${serviceAccount.project_id}).`);
      return db;
    } catch (err) {
      console.error('[Firebase] Error reading serviceAccountKey.json:', err.message);
    }
  }

  // 5. Check if running inside Google Cloud environment with default credentials
  if (process.env.GAE_ENV || process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT) {
    try {
      if (!admin.apps.length) {
        admin.initializeApp();
      }
      db = admin.firestore();
      console.log('[Firebase] Production Firestore initialized successfully via Google Cloud Platform default environment.');
      return db;
    } catch (err) {
      console.error('[Firebase] GCP default credentials initialization failed:', err.message);
    }
  }

  // 6. Safe in-memory fallback for local development without credentials
  isMock = true;
  db = createMockFirestore();
  return db;
}

module.exports = {
  getFirestore: initFirestore,
  admin
};
