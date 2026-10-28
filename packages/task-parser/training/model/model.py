"""A small transformer that labels task input words and scores the user's tags."""

from __future__ import annotations

import json
import math
from pathlib import Path

import torch
from safetensors.torch import load_file
from torch import nn

from features import ELECTRA, SHAPES, SPECIALS, TAG_NAMES


class Config:
    def __init__(self, **kwargs):
        # ELECTRA-small, a pretrained post-norm BERT-style encoder fine-tuned here.
        self.dim = 256
        self.layers = 12
        self.heads = 4
        self.ffn = 1024
        self.dropout = 0.1
        self.max_positions = 256
        self.embedding_dim = 128
        self.vocab = 30522
        self.__dict__.update(kwargs)

    def to_dict(self):
        return dict(self.__dict__)


class Layer(nn.Module):
    """BERT/ELECTRA post-norm layer (exact GELU), loadable from pretrained weights.
    Kept plain so the TypeScript port is a few loops."""

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


class TaskParser(nn.Module):
    def __init__(self, c: Config):
        super().__init__()
        self.config = c
        self.words = nn.Embedding(c.vocab, c.embedding_dim)
        # Inputs are summed and normalized at embedding width, then projected.
        width = c.embedding_dim
        self.project = nn.Linear(width, c.dim)
        self.specials = nn.Embedding(len(SPECIALS), width)
        self.shapes = nn.Embedding(len(SHAPES), width)
        self.segments = nn.Embedding(2, width)
        self.flags = nn.Embedding(4, width)  # spaced + 2 * overlap
        self.positions = nn.Embedding(c.max_positions, width)
        self.drop = nn.Dropout(c.dropout)
        # New features start at zero so the pretrained inputs are intact.
        nn.init.zeros_(self.shapes.weight)
        nn.init.zeros_(self.flags.weight)
        self.embed_norm = nn.LayerNorm(width, eps=1e-12)
        self.layers = nn.ModuleList(Layer(c) for _ in range(c.layers))
        self.spans = nn.Linear(c.dim, len(TAG_NAMES))
        self.tag_hidden = nn.Linear(c.dim, c.dim)
        self.tag_out = nn.Linear(c.dim, 1)
        # Static-embedding similarity between a tag's words and the text's
        # words (max, mean of top 3), so unseen tag names still match by meaning.
        self.tag_similarity = nn.Linear(2, c.dim)

    def embed(self, batch):
        """Summed input embeddings of a batch of sequences."""
        ids, specials = batch["ids"], batch["specials"]
        x = torch.where((specials > 0)[..., None], self.specials(specials), self.words(ids.clamp(min=0)))
        positions = torch.arange(ids.shape[1], device=ids.device)[None, :]
        x = (
            x
            + self.shapes(batch["shapes"])
            + self.segments(batch["segments"])
            + self.flags(batch["spaced"] + 2 * batch["overlap"])
            + self.positions(positions)
        )
        return self.project(self.drop(self.embed_norm(x)))

    def forward(self, batch):
        x = self.embed(batch)
        for layer in self.layers:
            x = layer(x, batch["mask"])
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


def load_run(run: Path, weights: str = "model.safetensors") -> TaskParser:
    """A trained run (runs/<name>) in eval mode."""
    model = TaskParser(Config(**json.loads((run / "config.json").read_text())))
    model.load_state_dict(load_file(str(run / weights)))
    return model.eval()


def load_electra(model: TaskParser, vocab: dict[str, int]):
    """Copy the pretrained ELECTRA weights into `model`."""
    w = load_file(str(ELECTRA / "model.safetensors"))
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

