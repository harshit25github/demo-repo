from openai import OpenAI
import numpy as np
client = OpenAI(api_key="YOUR_KEY")

a = "man bites dog"
b = "dog bites man"

emb_a = client.embeddings.create(model="text-embedding-ada-002", input=a).data[0].embedding
emb_b = client.embeddings.create(model="text-embedding-ada-002", input=b).data[0].embedding

def cosine(u, v):
    u, v = np.array(u), np.array(v)
    return np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v))

print("cosine similarity:", cosine(emb_a, emb_b))
