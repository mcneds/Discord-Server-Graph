#!/usr/bin/env python3
"""
bridge_rank_patched.py

Bridging-user discovery for Discord-style server membership exports.

Main practical methods implemented from the literature:
- TF-IDF + cosine kNN server graph
- TruncatedSVD/LSA embeddings + cosine kNN server graph
- Fingerprint / 2-hop similarity graph
- Louvain community detection (NetworkX built-in if available; optional python-louvain fallback)
- Optional Leiden if igraph + leidenalg are installed

Design goals:
- Required deps only: numpy, scipy, scikit-learn, networkx
- Optional deps loaded lazily, so Pylance/import errors disappear unless you actually choose that mode
- Bridge scoring favors users with multiple substantial, separate islands rather than one giant niche cluster
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import dataclass
from typing import Dict, List, Set, Tuple, Optional

import numpy as np
import networkx as nx
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfTransformer
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import normalize


@dataclass
class UserInfo:
    user_id: str
    username: str
    display_name: str


@dataclass
class ServerInfo:
    server_id: str
    server_name: str
    size: int


@dataclass
class BridgeResult:
    user_id: str
    username: str
    display_name: str
    mutuals: int
    islands: int
    meaningful_islands: int
    top_two_sizes: Tuple[int, int]
    top_two_distance: float
    largest_island_share: float
    score: float
    islands_servers: List[List[str]]


def load_discord_export(path: str, my_user_id: str, exclude_bots: bool = True):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    servers_raw = data.get("servers", [])
    servers: List[ServerInfo] = []
    users: Dict[str, UserInfo] = {}
    user_to_servers: Dict[str, Set[int]] = {}
    server_to_users: Dict[int, Set[str]] = {}

    for s_idx, s in enumerate(servers_raw):
        server_id = str(s.get("server_id", ""))
        server_name = s.get("server_name", f"Unknown Server {s_idx}")
        members = s.get("members", [])

        filtered_user_ids: Set[str] = set()
        for m in members:
            if exclude_bots and bool(m.get("is_bot", False)):
                continue
            uid = str(m.get("user_id", ""))
            if not uid or uid == my_user_id:
                continue

            filtered_user_ids.add(uid)
            if uid not in users:
                users[uid] = UserInfo(
                    user_id=uid,
                    username=str(m.get("username", "")),
                    display_name=str(m.get("display_name", "")),
                )

        servers.append(ServerInfo(server_id=server_id, server_name=server_name, size=len(filtered_user_ids)))
        server_to_users[s_idx] = filtered_user_ids

        for uid in filtered_user_ids:
            user_to_servers.setdefault(uid, set()).add(s_idx)

    return servers, users, user_to_servers, server_to_users


def build_server_user_matrix(servers, server_to_users, user_ids):
    user_index = {uid: j for j, uid in enumerate(user_ids)}
    rows, cols, data = [], [], []

    for s_idx in range(len(servers)):
        for uid in server_to_users[s_idx]:
            j = user_index.get(uid)
            if j is None:
                continue
            rows.append(s_idx)
            cols.append(j)
            data.append(1.0)

    X = sparse.coo_matrix((data, (rows, cols)), shape=(len(servers), len(user_ids)), dtype=np.float32)
    return X.tocsr()


def apply_weighting(X_counts: sparse.csr_matrix, weighting: str, ppmi_shift: float):
    if weighting == "tfidf":
        tfidf = TfidfTransformer(norm="l2", use_idf=True, smooth_idf=True, sublinear_tf=False)
        return tfidf.fit_transform(X_counts).tocsr()

    if weighting == "ppmi":
        X = X_counts.tocoo()
        row_deg = np.asarray(X_counts.sum(axis=1)).ravel()
        col_deg = np.asarray(X_counts.sum(axis=0)).ravel()
        total = float(X_counts.sum())

        row_deg[row_deg == 0] = 1.0
        col_deg[col_deg == 0] = 1.0
        if total == 0:
            return X_counts

        denom = row_deg[X.row] * col_deg[X.col]
        pmi = np.log((total * X.data) / denom)
        if ppmi_shift > 0:
            pmi = pmi - ppmi_shift
        ppmi = np.maximum(pmi, 0.0).astype(np.float32)

        X_ppmi = sparse.coo_matrix((ppmi, (X.row, X.col)), shape=X_counts.shape, dtype=np.float32).tocsr()
        return normalize(X_ppmi, norm="l2", axis=1).tocsr()

    raise ValueError(f"Unknown weighting: {weighting}")


def knn_edges_cosine(features, k: int, min_sim: float, n_jobs: int):
    nn = NearestNeighbors(
        n_neighbors=min(k + 1, features.shape[0]),
        metric="cosine",
        algorithm="brute",
        n_jobs=n_jobs,
    )
    nn.fit(features)
    distances, indices = nn.kneighbors(features, return_distance=True)

    edges = []
    for i in range(features.shape[0]):
        for dist, j in zip(distances[i], indices[i]):
            if i == j:
                continue
            sim = 1.0 - float(dist)
            if sim >= min_sim:
                edges.append((i, int(j), sim))
    return edges


def build_server_graph_from_edges(n_servers: int, edges):
    G = nx.Graph()
    G.add_nodes_from(range(n_servers))
    for i, j, w in edges:
        if i == j:
            continue
        if G.has_edge(i, j):
            if w > G[i][j]["weight"]:
                G[i][j]["weight"] = w
        else:
            G.add_edge(i, j, weight=w)
    return G


def compute_fingerprint_features(G: nx.Graph, n_servers: int):
    rows, cols, data = [], [], []
    for i in range(n_servers):
        for j, attrs in G[i].items():
            rows.append(i)
            cols.append(j)
            data.append(float(attrs.get("weight", 0.0)))
    W = sparse.coo_matrix((data, (rows, cols)), shape=(n_servers, n_servers), dtype=np.float32).tocsr()
    return normalize(W, norm="l2", axis=1)


def build_server_graph(Xw, method: str, k: int, min_sim: float, svd_dims: int,
                       fingerprint_k: int, fingerprint_min_sim: float, n_jobs: int, seed: int):
    n_servers = Xw.shape[0]
    diag = {}

    if method == "tfidf_graph":
        edges = knn_edges_cosine(Xw, k=k, min_sim=min_sim, n_jobs=n_jobs)
        G = build_server_graph_from_edges(n_servers, edges)
        diag["server_edges"] = float(G.number_of_edges())
        return G, None, diag

    if method == "svd_embed":
        svd = TruncatedSVD(n_components=min(svd_dims, max(2, n_servers - 1)), random_state=seed)
        E = svd.fit_transform(Xw)
        E = E / (np.linalg.norm(E, axis=1, keepdims=True) + 1e-9)
        edges = knn_edges_cosine(E, k=k, min_sim=min_sim, n_jobs=n_jobs)
        G = build_server_graph_from_edges(n_servers, edges)
        diag["svd_explained_variance_sum"] = float(np.sum(svd.explained_variance_ratio_))
        diag["server_edges"] = float(G.number_of_edges())
        return G, E, diag

    if method == "fingerprint_2hop":
        base_edges = knn_edges_cosine(Xw, k=k, min_sim=min_sim, n_jobs=n_jobs)
        G0 = build_server_graph_from_edges(n_servers, base_edges)
        W = compute_fingerprint_features(G0, n_servers)
        fp_edges = knn_edges_cosine(W, k=fingerprint_k, min_sim=fingerprint_min_sim, n_jobs=n_jobs)
        G = build_server_graph_from_edges(n_servers, fp_edges)
        diag["base_edges"] = float(G0.number_of_edges())
        diag["server_edges"] = float(G.number_of_edges())
        return G, None, diag

    raise ValueError(f"Unknown method: {method}")


def louvain_partition(G: nx.Graph, resolution: float, seed: int):
    try:
        from networkx.algorithms.community.louvain import louvain_communities
        comms = louvain_communities(G, weight="weight", resolution=resolution, seed=seed)
        mapping = {}
        for cid, nodes in enumerate(comms):
            for n in nodes:
                mapping[int(n)] = cid
        return mapping
    except Exception:
        pass

    try:
        import community as community_louvain
        part = community_louvain.best_partition(G, weight="weight", resolution=resolution, random_state=seed)
        return {int(n): int(cid) for n, cid in part.items()}
    except Exception as e:
        raise RuntimeError(
            "No Louvain implementation found. Install networkx>=3.2 or pip install python-louvain"
        ) from e


def leiden_partition_optional(G: nx.Graph, resolution: float, seed: int):
    try:
        import igraph as ig
        import leidenalg

        nodes = list(G.nodes())
        index = {n: i for i, n in enumerate(nodes)}
        edges = [(index[u], index[v]) for u, v in G.edges()]
        weights = [float(G[u][v].get("weight", 1.0)) for u, v in G.edges()]

        g = ig.Graph(n=len(nodes), edges=edges, directed=False)
        g.es["weight"] = weights

        part = leidenalg.find_partition(
            g,
            leidenalg.RBConfigurationVertexPartition,
            weights="weight",
            resolution_parameter=resolution,
            seed=seed,
        )

        mapping = {}
        for cid, cluster in enumerate(part):
            for ig_node in cluster:
                mapping[int(nodes[ig_node])] = cid
        return mapping
    except Exception:
        return None


def island_distance_by_graph_edges(G: nx.Graph, island_a: List[int], island_b: List[int]):
    weights = []
    set_b = set(island_b)
    for u in island_a:
        for v, attrs in G[u].items():
            if v in set_b:
                weights.append(float(attrs.get("weight", 0.0)))
    if not weights:
        return 1.0
    cross_sim = float(np.mean(weights))
    return max(0.0, min(1.0, 1.0 - cross_sim))


def score_user_bridge(G: nx.Graph, shared_servers: List[int], server_names: List[str], min_island_size: int):
    total = len(shared_servers)
    if total == 0:
        return None, {}

    sub = G.subgraph(shared_servers)
    components = [sorted(list(c)) for c in nx.connected_components(sub)]
    components.sort(key=len, reverse=True)

    sizes = [len(c) for c in components]
    largest_share = max(sizes) / total

    meaningful = [c for c in components if len(c) >= min_island_size]
    if len(meaningful) < 2:
        return None, {"reason": 1.0, "mutuals": float(total), "largest_share": float(largest_share)}

    meaningful.sort(key=len, reverse=True)
    top = meaningful[0]
    second = meaningful[1]
    s1, s2 = len(top), len(second)

    dist = island_distance_by_graph_edges(G, top, second)
    confidence = 1.0 - math.exp(-(total - 2) / 3.0)
    bridge_mass = min(s1, s2) * math.sqrt(s1 * s2)
    extra_meaningful = max(0, len(meaningful) - 2)

    score = confidence * bridge_mass * dist + 0.35 * float(extra_meaningful)
    if largest_share > 0.75:
        score *= 0.7

    islands_servers_names = [[server_names[i] for i in comp] for comp in components]

    result = BridgeResult(
        user_id="",
        username="",
        display_name="",
        mutuals=total,
        islands=len(components),
        meaningful_islands=len(meaningful),
        top_two_sizes=(s1, s2),
        top_two_distance=float(dist),
        largest_island_share=float(largest_share),
        score=float(score),
        islands_servers=islands_servers_names,
    )

    diag = {
        "confidence": float(confidence),
        "bridge_mass": float(bridge_mass),
        "dist": float(dist),
        "largest_share": float(largest_share),
    }
    return result, diag


def print_edge_similarity_quantiles(G: nx.Graph, label: str):
    weights = [float(G[u][v].get("weight", 0.0)) for u, v in G.edges()]
    if not weights:
        print(f"[diag] {label}: no edges.")
        return
    qs = np.quantile(weights, [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1.0])
    print(f"[diag] {label}: edge-weight quantiles:")
    print("       " + "  ".join([f"{q:>6.2f}" for q in [0, 10, 25, 50, 75, 90, 99, 100]]))
    print("       " + "  ".join([f"{v:>6.3f}" for v in qs]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="mutual-server-members.json")
    ap.add_argument("--my-user-id", required=True)
    ap.add_argument("--top-n", type=int, default=50)
    ap.add_argument("--min-mutuals", type=int, default=6)
    ap.add_argument("--min-island-size", type=int, default=2)

    ap.add_argument("--weighting", choices=["tfidf", "ppmi"], default="tfidf")
    ap.add_argument("--ppmi-shift", type=float, default=0.0)

    ap.add_argument("--method", choices=["tfidf_graph", "svd_embed", "fingerprint_2hop"], default="svd_embed")
    ap.add_argument("--k", type=int, default=30)
    ap.add_argument("--min-sim", type=float, default=0.15)
    ap.add_argument("--svd-dims", type=int, default=64)
    ap.add_argument("--fingerprint-k", type=int, default=30)
    ap.add_argument("--fingerprint-min-sim", type=float, default=0.18)

    ap.add_argument("--community", choices=["louvain", "leiden"], default="louvain")
    ap.add_argument("--resolution", type=float, default=1.0)
    ap.add_argument("--export-csv", default="bridge_users.csv")
    ap.add_argument("--n-jobs", type=int, default=1)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--diagnostics", action="store_true")
    args = ap.parse_args()

    servers, users, user_to_servers, server_to_users = load_discord_export(
        args.json,
        my_user_id=args.my_user_id,
        exclude_bots=True,
    )

    server_names = [s.server_name for s in servers]
    user_ids = sorted(list(users.keys()))

    print(f"[info] servers: {len(servers)}")
    print(f"[info] users (excluding you/bots): {len(user_ids)}")
    print(f"[info] membership edges: {sum(s.size for s in servers)}")

    X_counts = build_server_user_matrix(servers, server_to_users, user_ids)
    Xw = apply_weighting(X_counts, weighting=args.weighting, ppmi_shift=args.ppmi_shift)

    G_server, E, diag = build_server_graph(
        Xw=Xw,
        method=args.method,
        k=args.k,
        min_sim=args.min_sim,
        svd_dims=args.svd_dims,
        fingerprint_k=args.fingerprint_k,
        fingerprint_min_sim=args.fingerprint_min_sim,
        n_jobs=args.n_jobs,
        seed=args.seed,
    )

    print(f"[info] server-graph edges: {G_server.number_of_edges()}")
    for k, v in diag.items():
        print(f"[info] {k}: {v}")

    if args.diagnostics:
        print_edge_similarity_quantiles(G_server, "server graph")

    if args.community == "leiden":
        part = leiden_partition_optional(G_server, resolution=args.resolution, seed=args.seed)
        if part is None:
            print("[warn] leidenalg/igraph not installed; falling back to Louvain.")
            part = louvain_partition(G_server, resolution=args.resolution, seed=args.seed)
    else:
        part = louvain_partition(G_server, resolution=args.resolution, seed=args.seed)

    print(f"[info] detected server communities: {len(set(part.values()))}")

    results: List[BridgeResult] = []
    for uid, sset in user_to_servers.items():
        shared = sorted(list(sset))
        if len(shared) < args.min_mutuals:
            continue

        br, _ = score_user_bridge(
            G=G_server,
            shared_servers=shared,
            server_names=server_names,
            min_island_size=args.min_island_size,
        )
        if br is None:
            continue

        info = users.get(uid)
        if info is None:
            continue

        br.user_id = uid
        br.username = info.username
        br.display_name = info.display_name
        results.append(br)

    results.sort(key=lambda r: (-r.score, -min(r.top_two_sizes), -r.mutuals))

    print("\n=== TOP BRIDGE USERS ===\n")
    for i, r in enumerate(results[: args.top_n], start=1):
        name = r.display_name or r.username or r.user_id
        s1, s2 = r.top_two_sizes
        print(
            f"{i:>2}. {name} (@{r.username}) | score={r.score:.3f} | "
            f"mutuals={r.mutuals} | islands={r.islands} | meaningful={r.meaningful_islands} | "
            f"top_two={s1}+{s2} | top_two_distance={r.top_two_distance:.2f} | "
            f"largest_share={r.largest_island_share:.2f}"
        )

    with open(args.export_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "rank", "user_id", "username", "display_name", "score", "mutuals",
            "islands", "meaningful_islands", "top_two_sizes", "top_two_distance",
            "largest_island_share", "islands_servers"
        ])
        for rank, r in enumerate(results, start=1):
            w.writerow([
                rank,
                r.user_id,
                r.username,
                r.display_name,
                f"{r.score:.6f}",
                r.mutuals,
                r.islands,
                r.meaningful_islands,
                f"{r.top_two_sizes[0]}+{r.top_two_sizes[1]}",
                f"{r.top_two_distance:.6f}",
                f"{r.largest_island_share:.6f}",
                json.dumps(r.islands_servers, ensure_ascii=False),
            ])

    print(f"\n[info] wrote CSV: {args.export_csv}")
    print("\nEnter a rank number to inspect, or press Enter to quit.")

    while True:
        choice = input("> ").strip()
        if not choice:
            break
        if not choice.isdigit():
            continue

        idx = int(choice) - 1
        if not (0 <= idx < min(args.top_n, len(results))):
            continue

        r = results[idx]
        name = r.display_name or r.username or r.user_id
        print(f"\n{name} (@{r.username})")
        print(f"score={r.score:.3f}")
        print(f"mutuals={r.mutuals}")
        print(f"islands={r.islands} (meaningful={r.meaningful_islands})")
        print(f"top_two_sizes={r.top_two_sizes[0]}+{r.top_two_sizes[1]}")
        print(f"top_two_distance={r.top_two_distance:.3f}")
        print(f"largest_island_share={r.largest_island_share:.3f}\n")

        for j, island in enumerate(r.islands_servers, start=1):
            print(f"Island {j} | size={len(island)}")
            for sname in island:
                print(f"   - {sname}")
            print()


if __name__ == "__main__":
    main()
