"""A small transformer that labels task input words and scores the user's tags."""

from __future__ import annotations

import math

import torch
from torch import nn

from features import SHAPES, SPECIALS, TAG_NAMES


class Config:
    def __init__(self, **kwargs):
        self.dim = 160
        self.layers = 4
        self.heads = 4
        self.ffn = 448
        self.dropout = 0.1
        self.max_positions = 256
        self.embedding_dim = 128
        self.vocab = 29528
        # "scratch": pre-norm layers trained here; "electra": a pretrained
        # post-norm BERT-style encoder (ELECTRA-small) fine-tuned here;
        # "modernbert": a pretrained ModernBERT-style encoder (Ettin) with
        # RoPE, GeGLU, no biases and local attention in most layers.
        self.arch = "scratch"
        self.rope_theta = 160000.0
        self.local_window = 128
        self.global_every = 3
        self.__dict__.update(kwargs)

    def to_dict(self):
        return dict(self.__dict__)


class Layer(nn.Module):
    """Pre-norm encoder layer. Kept plain so the TypeScript port is a few loops."""

    def __init__(self, c: Config):
        super().__init__()
        self.heads = c.heads
        self.norm1 = nn.LayerNorm(c.dim)
        self.qkv = nn.Linear(c.dim, 3 * c.dim)
        self.out = nn.Linear(c.dim, c.dim)
        self.norm2 = nn.LayerNorm(c.dim)
        self.up = nn.Linear(c.dim, c.ffn)
        self.down = nn.Linear(c.ffn, c.dim)
        self.drop = nn.Dropout(c.dropout)

    def forward(self, x, mask):
        b, n, d = x.shape
        h = self.norm1(x)
        q, k, v = self.qkv(h).view(b, n, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        scores = (q @ k.transpose(-1, -2)) / math.sqrt(d // self.heads)
        scores = scores.masked_fill(~mask[:, None, None, :], float("-inf"))
        attention = self.drop(scores.softmax(-1))
        x = x + self.drop(self.out((attention @ v).transpose(1, 2).reshape(b, n, d)))
        x = x + self.drop(self.down(nn.functional.gelu(self.up(self.norm2(x)), approximate="tanh")))
        return x


class PostLayer(nn.Module):
    """BERT/ELECTRA post-norm layer (exact GELU), loadable from pretrained weights."""

    def __init__(self, c: Config):
        super().__init__()
        self.heads = c.heads
        self.qkv = nn.Linear(c.dim, 3 * c.dim)
        self.out = nn.Linear(c.dim, c.dim)
        self.norm1 = nn.LayerNorm(c.dim, eps=1e-12)
        self.up = nn.Linear(c.dim, c.ffn)
        self.down = nn.Linear(c.ffn, c.dim)
        self.norm2 = nn.LayerNorm(c.dim, eps=1e-12)
        self.drop = nn.Dropout(c.dropout)

    def forward(self, x, mask):
        b, n, d = x.shape
        q, k, v = self.qkv(x).view(b, n, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        scores = (q @ k.transpose(-1, -2)) / math.sqrt(d // self.heads)
        scores = scores.masked_fill(~mask[:, None, None, :], float("-inf"))
        attention = self.drop(scores.softmax(-1))
        x = self.norm1(x + self.drop(self.out((attention @ v).transpose(1, 2).reshape(b, n, d))))
        return self.norm2(x + self.drop(self.down(nn.functional.gelu(self.up(x)))))


def rope(x, theta: float):
    """Rotary position embedding on [b, heads, n, d] (rotate-half form)."""
    n, d = x.shape[-2], x.shape[-1]
    inv = 1.0 / (theta ** (torch.arange(0, d, 2, device=x.device, dtype=torch.float32) / d))
    freqs = torch.outer(torch.arange(n, device=x.device, dtype=torch.float32), inv)
    angles = torch.cat([freqs, freqs], dim=-1)
    cos, sin = angles.cos().to(x.dtype), angles.sin().to(x.dtype)
    half = torch.cat([-x[..., d // 2 :], x[..., : d // 2]], dim=-1)
    return x * cos + half * sin


class ModernLayer(nn.Module):
    """ModernBERT/Ettin layer: pre-norm (no biases), RoPE, GeGLU; local layers
    attend within +-window/2 tokens."""

    def __init__(self, c: Config, index: int):
        super().__init__()
        self.heads = c.heads
        self.theta = c.rope_theta
        self.local = index % c.global_every != 0
        self.half_window = c.local_window // 2
        self.attn_norm = nn.LayerNorm(c.dim, bias=False) if index > 0 else nn.Identity()
        self.qkv = nn.Linear(c.dim, 3 * c.dim, bias=False)
        self.out = nn.Linear(c.dim, c.dim, bias=False)
        self.mlp_norm = nn.LayerNorm(c.dim, bias=False)
        self.up = nn.Linear(c.dim, 2 * c.ffn, bias=False)
        self.down = nn.Linear(c.ffn, c.dim, bias=False)
        self.drop = nn.Dropout(c.dropout)

    def forward(self, x, mask):
        b, n, d = x.shape
        q, k, v = self.qkv(self.attn_norm(x)).view(b, n, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        q, k = rope(q, self.theta), rope(k, self.theta)
        scores = (q @ k.transpose(-1, -2)) / math.sqrt(d // self.heads)
        allowed = mask[:, None, None, :]
        if self.local:
            positions = torch.arange(n, device=x.device)
            distance = (positions[:, None] - positions[None, :]).abs()
            # Each token may always see itself, so a padding row far from
            # every real token isn't left with nothing to attend to.
            allowed = (allowed & (distance <= self.half_window)) | (distance == 0)
        scores = scores.masked_fill(~allowed, float("-inf"))
        attention = self.drop(scores.softmax(-1))
        x = x + self.drop(self.out((attention @ v).transpose(1, 2).reshape(b, n, d)))
        gate_in, gate = self.up(self.mlp_norm(x)).chunk(2, dim=-1)
        return x + self.drop(self.down(nn.functional.gelu(gate_in) * gate))


class TaskParser(nn.Module):
    def __init__(self, c: Config, embeddings: torch.Tensor | None = None):
        super().__init__()
        self.config = c
        self.words = nn.Embedding(c.vocab, c.embedding_dim)
        if embeddings is not None:
            self.words.weight.data.copy_(embeddings)
        self.project = nn.Linear(c.embedding_dim, c.dim)
        # Pretrained encoders take their inputs at embedding width, summed
        # and normalized before the projection; the scratch encoder after it.
        width = c.embedding_dim if c.arch in ("electra", "modernbert") else c.dim
        self.specials = nn.Embedding(len(SPECIALS), width)
        self.shapes = nn.Embedding(len(SHAPES), width)
        self.segments = nn.Embedding(2, width)
        self.flags = nn.Embedding(4, width)  # spaced + 2 * overlap
        self.positions = nn.Embedding(c.max_positions, width)
        self.drop = nn.Dropout(c.dropout)
        if c.arch in ("electra", "modernbert"):
            # New features start at zero so the pretrained inputs are intact.
            nn.init.zeros_(self.shapes.weight)
            nn.init.zeros_(self.flags.weight)
        if c.arch == "electra":
            self.embed_norm = nn.LayerNorm(width, eps=1e-12)
            self.layers = nn.ModuleList(PostLayer(c) for _ in range(c.layers))
        elif c.arch == "modernbert":
            # RoPE carries position, so the position and segment tables start
            # at zero too; there is no projection (embedding width = model width).
            nn.init.zeros_(self.positions.weight)
            nn.init.zeros_(self.segments.weight)
            self.embed_norm = nn.LayerNorm(width, bias=False)
            self.layers = nn.ModuleList(ModernLayer(c, i) for i in range(c.layers))
            self.norm = nn.LayerNorm(c.dim, bias=False)
        else:
            self.layers = nn.ModuleList(Layer(c) for _ in range(c.layers))
            self.norm = nn.LayerNorm(c.dim)
        self.spans = nn.Linear(c.dim, len(TAG_NAMES))
        self.tag_hidden = nn.Linear(c.dim, c.dim)
        self.tag_out = nn.Linear(c.dim, 1)
        # Static-embedding similarity between a tag's words and the text's
        # words (max, mean of top 3), so unseen tag names still match by meaning.
        self.tag_similarity = nn.Linear(2, c.dim)

    def forward(self, batch):
        ids, specials = batch["ids"], batch["specials"]
        is_special = specials > 0
        arch = self.config.arch
        words = self.words(ids.clamp(min=0))
        if arch == "scratch":
            words = self.project(words)
        x = torch.where(is_special[..., None], self.specials(specials), words)
        positions = torch.arange(ids.shape[1], device=ids.device)[None, :]
        x = (
            x
            + self.shapes(batch["shapes"])
            + self.segments(batch["segments"])
            + self.flags(batch["spaced"] + 2 * batch["overlap"])
            + self.positions(positions)
        )
        if arch == "electra":
            x = self.project(self.drop(self.embed_norm(x)))
        elif arch == "modernbert":
            x = self.drop(self.embed_norm(x))
        else:
            x = self.drop(x)
        mask = batch["mask"]
        for layer in self.layers:
            x = layer(x, mask)
        if arch != "electra":
            x = self.norm(x)
        span_logits = self.spans(x)
        tag_states = x.gather(1, batch["tag_positions"].clamp(min=0)[..., None].expand(-1, -1, x.shape[-1]))
        tag_states = tag_states + self.tag_similarity(self.similarity(batch))
        tag_logits = self.tag_out(nn.functional.gelu(self.tag_hidden(tag_states), approximate="tanh")).squeeze(-1)
        return span_logits, tag_logits

    def similarity(self, batch):
        """[batch, tags, 2]: max and top-3 mean cosine similarity of each tag's
        mean word embedding to the text's word embeddings."""
        static = nn.functional.normalize(self.words(batch["ids"].clamp(min=0)), dim=-1)
        members = batch["tag_members"].float()  # [B, tags, N]
        tag_vectors = nn.functional.normalize(members @ static, dim=-1)  # [B, tags, E]
        sims = tag_vectors @ static.transpose(1, 2)  # [B, tags, N]
        text = batch["text_words"][:, None, :]  # [B, 1, N]
        sims = sims.masked_fill(~text, -1.0)
        top = sims.topk(min(3, sims.shape[-1]), dim=-1).values
        has_text = text.any(-1)  # [B, 1]
        features = torch.stack([top[..., 0], top.mean(-1)], dim=-1)
        return torch.where(has_text[..., None], features, torch.zeros_like(features))


def load_electra(model: TaskParser, path: str, vocab: dict[str, int]):
    """Copy ELECTRA-small weights (data/embeddings/electra-small) into `model`."""
    from safetensors.torch import load_file

    w = load_file(path)
    e = "electra.embeddings."
    with torch.no_grad():
        model.words.weight.copy_(w[e + "word_embeddings.weight"])
        model.positions.weight.copy_(w[e + "position_embeddings.weight"][: model.positions.weight.shape[0]])
        model.segments.weight.copy_(w[e + "token_type_embeddings.weight"])
        model.embed_norm.weight.copy_(w[e + "LayerNorm.weight"])
        model.embed_norm.bias.copy_(w[e + "LayerNorm.bias"])
        model.project.weight.copy_(w["electra.embeddings_project.weight"])
        model.project.bias.copy_(w["electra.embeddings_project.bias"])
        # [PAD] [CLS] [SEP] start as their pretrained tokens; [URL] and [TAG]
        # as unused slots.
        for index, token in enumerate(["[PAD]", "[CLS]", "[SEP]", "[unused0]", "[unused1]"]):
            model.specials.weight[index].copy_(w[e + "word_embeddings.weight"][vocab[token]])
        for i, layer in enumerate(model.layers):
            p = f"electra.encoder.layer.{i}."
            a = p + "attention.self."
            layer.qkv.weight.copy_(torch.cat([w[a + "query.weight"], w[a + "key.weight"], w[a + "value.weight"]]))
            layer.qkv.bias.copy_(torch.cat([w[a + "query.bias"], w[a + "key.bias"], w[a + "value.bias"]]))
            layer.out.weight.copy_(w[p + "attention.output.dense.weight"])
            layer.out.bias.copy_(w[p + "attention.output.dense.bias"])
            layer.norm1.weight.copy_(w[p + "attention.output.LayerNorm.weight"])
            layer.norm1.bias.copy_(w[p + "attention.output.LayerNorm.bias"])
            layer.up.weight.copy_(w[p + "intermediate.dense.weight"])
            layer.up.bias.copy_(w[p + "intermediate.dense.bias"])
            layer.down.weight.copy_(w[p + "output.dense.weight"])
            layer.down.bias.copy_(w[p + "output.dense.bias"])
            layer.norm2.weight.copy_(w[p + "output.LayerNorm.weight"])
            layer.norm2.bias.copy_(w[p + "output.LayerNorm.bias"])


def load_modernbert(model: TaskParser, path: str, vocab: dict[str, int]):
    """Copy ModernBERT/Ettin weights (data/embeddings/ettin-*) into `model`."""
    from safetensors.torch import load_file

    w = load_file(path)
    with torch.no_grad():
        words = w["model.embeddings.tok_embeddings.weight"]
        model.words.weight.copy_(words)
        model.embed_norm.weight.copy_(w["model.embeddings.norm.weight"])
        model.norm.weight.copy_(w["model.final_norm.weight"])
        # [PAD] [CLS] [SEP] start as their pretrained tokens; [URL] and [TAG]
        # as [MASK] and [UNK].
        for index, token in enumerate(["[PAD]", "[CLS]", "[SEP]", "[MASK]", "[UNK]"]):
            model.specials.weight[index].copy_(words[vocab[token]])
        for i, layer in enumerate(model.layers):
            p = f"model.layers.{i}."
            if i > 0:
                layer.attn_norm.weight.copy_(w[p + "attn_norm.weight"])
            layer.qkv.weight.copy_(w[p + "attn.Wqkv.weight"])
            layer.out.weight.copy_(w[p + "attn.Wo.weight"])
            layer.mlp_norm.weight.copy_(w[p + "mlp_norm.weight"])
            layer.up.weight.copy_(w[p + "mlp.Wi.weight"])
            layer.down.weight.copy_(w[p + "mlp.Wo.weight"])
