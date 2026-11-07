"""
RepoIntelligenceEngine — RAG layer for CodeMe.

Indexes the repository into a local ChromaDB collection using Ollama embeddings
(nomic-embed-text by default), then provides semantic search and symbol lookup.

ChromaDB embedding function:
  We use a custom OllamaEmbeddingFunction so no sentence-transformers or
  OpenAI key is needed — everything runs locally through Ollama.
"""

from __future__ import annotations

import os
from typing import Dict, List

import chromadb
from chromadb import Documents, EmbeddingFunction, Embeddings

from services.repo_mapper import RepoMapper
from services.ollama_client import OllamaClient, OllamaError
from services.config import ConfigManager


# ------------------------------------------------------------------ #
#  Custom ChromaDB embedding function backed by Ollama                #
# ------------------------------------------------------------------ #

class OllamaEmbeddingFunction(EmbeddingFunction):
    """Passes documents to Ollama /api/embed and returns float vectors."""

    def __init__(self, model: str | None = None):
        self.model = model or ConfigManager.get_embed_model()

    def __call__(self, input: Documents) -> Embeddings:  # noqa: A002
        texts = list(input)
        try:
            return OllamaClient.embed(texts=texts, model=self.model)
        except OllamaError as exc:
            raise RuntimeError(f"Ollama embedding failed: {exc}") from exc


# ------------------------------------------------------------------ #
#  Engine                                                             #
# ------------------------------------------------------------------ #

class RepoIntelligenceEngine:
    def __init__(self, repo_path: str = "."):
        self.repo_path = os.path.abspath(repo_path)
        db_path = os.path.join(self.repo_path, ".codeme_db")

        self.chroma_client = chromadb.PersistentClient(path=db_path)
        self.embedding_fn = OllamaEmbeddingFunction()
        self.collection = self.chroma_client.get_or_create_collection(
            name="repo_code",
            embedding_function=self.embedding_fn,
        )

        self.ignore_dirs = {
            ".git", ".venv", "__pycache__", "node_modules",
            ".codeme_db", ".codeme_workspaces", ".pytest_cache",
        }
        self.allowed_extensions = {
            ".py", ".js", ".ts", ".tsx", ".jsx",
            ".html", ".css", ".md", ".json", ".yaml", ".yml",
        }

    # ------------------------------------------------------------------ #
    #  Indexing                                                            #
    # ------------------------------------------------------------------ #

    def index_repository(self) -> None:
        """
        Walks the repo, chunks source files into 100-line blocks, and upserts
        them into ChromaDB with Ollama-generated embeddings.
        """
        documents: List[str] = []
        metadatas: List[Dict] = []
        ids: List[str] = []

        print(f"Indexing repository at {self.repo_path}...")

        mapper = RepoMapper(self.repo_path)
        repo_map = mapper.build_map()

        for root, dirs, files in os.walk(self.repo_path):
            dirs[:] = [d for d in dirs if d not in self.ignore_dirs]

            for file in files:
                _, ext = os.path.splitext(file)
                if ext not in self.allowed_extensions:
                    continue

                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, self.repo_path)

                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()

                    file_symbols = repo_map.get(rel_path, {})
                    classes_str = ",".join(c["name"] for c in file_symbols.get("classes", []))
                    functions_str = ",".join(fn["name"] for fn in file_symbols.get("functions", []))

                    lines = content.split("\n")
                    chunk_size = 100
                    for i in range(0, len(lines), chunk_size):
                        chunk = "\n".join(lines[i : i + chunk_size])
                        if not chunk.strip():
                            continue
                        chunk_id = f"{rel_path}_chunk_{i // chunk_size}"
                        documents.append(chunk)
                        metadatas.append(
                            {
                                "file": rel_path,
                                "start_line": i,
                                "classes": classes_str,
                                "functions": functions_str,
                            }
                        )
                        ids.append(chunk_id)

                except Exception as exc:
                    print(f"Failed to read {rel_path}: {exc}")

        if not documents:
            print("No valid files found to index.")
            return

        # Batch upsert to avoid overwhelming the embedding model
        batch_size = 50
        for i in range(0, len(documents), batch_size):
            self.collection.upsert(
                documents=documents[i : i + batch_size],
                metadatas=metadatas[i : i + batch_size],
                ids=ids[i : i + batch_size],
            )

        print(f"Indexed {len(documents)} chunks.")

    # ------------------------------------------------------------------ #
    #  Search                                                              #
    # ------------------------------------------------------------------ #

    def search(self, query: str, n_results: int = 5) -> List[Dict]:
        """Semantic search across indexed repository chunks."""
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=min(n_results, max(self.collection.count(), 1)),
            )
        except Exception as exc:
            print(f"RepoIntelligence search error: {exc}")
            return []

        output = []
        if results and results.get("documents"):
            for i in range(len(results["documents"][0])):
                output.append(
                    {
                        "id": results["ids"][0][i],
                        "content": results["documents"][0][i],
                        "metadata": results["metadatas"][0][i],
                    }
                )
        return output

    def find_definition(self, symbol_name: str) -> List[Dict]:
        """Finds a class or function definition by symbol name."""
        try:
            results = self.collection.query(
                query_texts=[symbol_name],
                n_results=10,
                where={
                    "$or": [
                        {"classes": {"$contains": symbol_name}},
                        {"functions": {"$contains": symbol_name}},
                    ]
                },
            )
        except Exception as exc:
            print(f"RepoIntelligence find_definition error: {exc}")
            return []

        output = []
        if results and results.get("documents"):
            for i in range(len(results["documents"][0])):
                output.append(
                    {
                        "id": results["ids"][0][i],
                        "content": results["documents"][0][i],
                        "metadata": results["metadatas"][0][i],
                    }
                )
        return output


if __name__ == "__main__":
    engine = RepoIntelligenceEngine()
    engine.index_repository()
    res = engine.search("fastapi endpoints")
    print(res)
