#!/usr/bin/env python3
"""
=============================================================================
Faro — gera os ícones do app a partir do logo

    python3 tools/gerar-icones.py

POR QUE ISTO EXISTE
Ícone de PWA não é um arquivo só. O Android recorta o ícone em círculo,
losango ou "squircle" conforme o aparelho, e o que fica de fora some — por
isso existe o "maskable", com margem sobrando de propósito. O iOS usa o
apple-touch-icon e NÃO aceita transparência (vira preto). E a notificação do
Android exige um distintivo chapado, branco sobre transparente.

Redimensionar isso à mão, uma vez por tamanho, é como o ícone fica torto.
Aqui sai tudo do mesmo web/img/faro-marca.png.
=============================================================================
"""

from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
IMG = RAIZ / "web" / "img"
FUNDO = (255, 255, 255, 255)          # o logo é escuro: o fundo é o branco da marca


def compor(marca: Image.Image, lado: int, ocupacao: float) -> Image.Image:
    """Marca centrada num quadrado, ocupando `ocupacao` do lado."""
    tela = Image.new("RGBA", (lado, lado), FUNDO)
    cabe = int(lado * ocupacao)
    escala = min(cabe / marca.width, cabe / marca.height)
    largura, altura = round(marca.width * escala), round(marca.height * escala)
    peca = marca.resize((largura, altura), Image.LANCZOS)
    tela.alpha_composite(peca, ((lado - largura) // 2, (lado - altura) // 2))
    return tela


def distintivo(marca: Image.Image, lado: int) -> Image.Image:
    """Silhueta branca sobre transparente — o badge da notificação do Android.

    O sistema descarta a cor e usa só o alfa, então mandar o logo colorido
    daria uma mancha. Branco chapado é o que ele espera."""
    cabe = int(lado * 0.86)
    escala = min(cabe / marca.width, cabe / marca.height)
    largura, altura = round(marca.width * escala), round(marca.height * escala)
    alfa = marca.resize((largura, altura), Image.LANCZOS).split()[3]

    tela = Image.new("RGBA", (lado, lado), (255, 255, 255, 0))
    branco = Image.new("RGBA", (largura, altura), (255, 255, 255, 255))
    branco.putalpha(alfa)
    tela.alpha_composite(branco, ((lado - largura) // 2, (lado - altura) // 2))
    return tela


def main() -> None:
    marca = Image.open(IMG / "faro-marca.png").convert("RGBA")

    saidas = [
        # nome,                    lado, ocupação
        ("icone-192.png",           192, 0.86),
        ("icone-512.png",           512, 0.86),
        # Maskable: o recorte circular come ~20% da borda. 62% deixa a marca
        # inteira dentro da zona segura em qualquer formato de recorte.
        ("icone-maskable-192.png",  192, 0.62),
        ("icone-maskable-512.png",  512, 0.62),
        # iOS: mesma arte, sem transparência (o apple-touch-icon não aceita).
        ("icone-180.png",           180, 0.86),
    ]

    for nome, lado, ocupacao in saidas:
        img = compor(marca, lado, ocupacao)
        if nome == "icone-180.png":
            img = img.convert("RGB")   # iOS pinta de preto o que for transparente
        img.save(IMG / nome)
        print(f"  {nome}  {lado}×{lado}")

    distintivo(marca, 96).save(IMG / "badge-96.png")
    print("  badge-96.png  96×96 (silhueta branca)")


if __name__ == "__main__":
    main()
