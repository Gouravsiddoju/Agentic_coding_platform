import os
import chromadb
from typing import List, Dict
from services.repo_mapper import RepoMapper

class RepoIntelligenceEngine:
    def __init__(self, repo_path: str = "."):
        self.repo_path = os.path.abspath(repo_path)
        # Initialize local Chroma DB
        self.chroma_client = chromadb.PersistentClient(path=os.path.join(self.repo_path, ".optcode_db"))
        self.collection = self.chroma_client.get_or_create_collection(name="repo_code")
        self.ignore_dirs = {".git", ".venv", "__pycache__", "node_modules", ".optcode_db", ".pytest_cache"}
        self.allowed_extensions = {".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".md", ".json", ".yaml", ".yml"}

    def index_repository(self):
        """
        Scans the repository, chunks code files, and indexes them into ChromaDB.
        """
        documents = []
        metadatas = []
        ids = []
        
        print(f"Indexing repository at {self.repo_path}...")
        
        # Build symbol map for rich metadata
        mapper = RepoMapper(self.repo_path)
        repo_map = mapper.build_map()
        
        for root, dirs, files in os.walk(self.repo_path):
            # Mutate dirs in-place to ignore specified directories
            dirs[:] = [d for d in dirs if d not in self.ignore_dirs]
            
            for file in files:
                _, ext = os.path.splitext(file)
                if ext in self.allowed_extensions:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, self.repo_path)
                    
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            content = f.read()
                            
                            # Get symbols for this file
                            file_symbols = repo_map.get(rel_path, {})
                            classes_in_file = [c["name"] for c in file_symbols.get("classes", [])]
                            functions_in_file = [f["name"] for f in file_symbols.get("functions", [])]
                            
                            # Simple chunking by 100 lines
                            lines = content.split('\n')
                            chunk_size = 100
                            for i in range(0, len(lines), chunk_size):
                                chunk = '\n'.join(lines[i:i+chunk_size])
                                chunk_id = f"{rel_path}_chunk_{i//chunk_size}"
                                
                                documents.append(chunk)
                                metadatas.append({
                                    "file": rel_path, 
                                    "start_line": i,
                                    "classes": ",".join(classes_in_file),
                                    "functions": ",".join(functions_in_file)
                                })
                                ids.append(chunk_id)
                    except Exception as e:
                        print(f"Failed to read {rel_path}: {e}")
                        
        if documents:
            # Batch upsert to prevent overload
            batch_size = 100
            for i in range(0, len(documents), batch_size):
                self.collection.upsert(
                    documents=documents[i:i+batch_size],
                    metadatas=metadatas[i:i+batch_size],
                    ids=ids[i:i+batch_size]
                )
            print(f"Indexed {len(documents)} chunks from {self.repo_path}.")
        else:
            print("No valid files found to index.")

    def search(self, query: str, n_results: int = 5) -> List[Dict]:
        """
        Semantic search across the indexed repository.
        """
        results = self.collection.query(
            query_texts=[query],
            n_results=n_results
        )
        
        search_results = []
        if results and results.get("documents"):
            for i in range(len(results["documents"][0])):
                search_results.append({
                    "id": results["ids"][0][i],
                    "content": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i]
                })
        return search_results

    def find_definition(self, symbol_name: str) -> List[Dict]:
        """
        Finds the definition of a class or function by searching metadata.
        """
        # We query the collection using a where filter to match symbol names
        # Since Chroma doesn't natively support full-text search on metadata arrays well,
        # we do a semantic search with a filter.
        results = self.collection.query(
            query_texts=[symbol_name],
            n_results=10,
            where={"$or": [{"classes": {"$contains": symbol_name}}, {"functions": {"$contains": symbol_name}}]}
        )
        
        search_results = []
        if results and results.get("documents"):
            for i in range(len(results["documents"][0])):
                search_results.append({
                    "id": results["ids"][0][i],
                    "content": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i]
                })
        return search_results

if __name__ == "__main__":
    engine = RepoIntelligenceEngine()
    engine.index_repository()
    res = engine.search("fastapi endpoints")
    print(res)
