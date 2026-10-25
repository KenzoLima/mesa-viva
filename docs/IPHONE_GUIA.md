# iPhone: gerar o app na nuvem e instalar (sem Mac)

O Unity no Windows prepara o projeto, mas o último passo de um app de iPhone (compilar no Xcode e assinar) só roda num Mac. Por isso usamos o **Unity Build Automation**: ele pega o projeto do GitHub, compila num Mac da Unity e devolve um **link de instalação** para abrir no iPhone.

O que você vai configurar **uma vez só**:
1. conta de desenvolvedor da Apple;
2. certificado e perfil de instalação;
3. Unity Build Automation.

Depois, cada versão nova é: **push → Start build → abrir o link no iPhone**.

---

## 1. Conta Apple Developer

1. Assine o **Apple Developer Program** em https://developer.apple.com/programs com o seu Apple ID. Custa US$ 99/ano e a aprovação pode levar até 48 h.
2. Sem ela não dá para instalar o app no iPhone por um link nem pelo TestFlight.

## 2. Certificado de distribuição (feito no Windows com OpenSSL)

O OpenSSL vem junto com o Git (o GitHub Desktop instala). Abra o **Git Bash** numa pasta **fora do repositório** (ex.: `Documentos\apple`) e rode:

```bash
# 1. chave privada + pedido de certificado (troque email e nome)
openssl genrsa -out mesaviva.key 2048
openssl req -new -key mesaviva.key -out mesaviva.csr -subj "/emailAddress=SEU_EMAIL/CN=SEU NOME/C=BR"
```

1. No site da Apple: **Certificates, Identifiers & Profiles → Certificates → +** → **Apple Distribution**.
2. Envie o `mesaviva.csr` e baixe o `distribution.cer`.
3. Converta para `.p12`, o formato que o Unity Build Automation pede. Ele pede uma senha: **anote**.

```bash
openssl x509 -in distribution.cer -inform DER -out distribution.pem -outform PEM
openssl pkcs12 -export -legacy -inkey mesaviva.key -in distribution.pem -out mesaviva.p12
```

> 🔒 **`.key`, `.p12`, `.cer` e `.mobileprovision` nunca vão para o GitHub.** O `.gitignore` já bloqueia essas extensões, mas guarde-os fora da pasta do projeto mesmo assim.

## 3. App ID, iPhone e perfil de instalação

1. **Identifiers → + → App IDs → App**:
   - Description: `Mesa Viva`;
   - Bundle ID **Explicit**: `com.SEUNOME.mesaviva` (só letras minúsculas, números e pontos).
2. **UDID do iPhone:**
   - instale o app **Apple Devices** (Microsoft Store) ou o iTunes;
   - conecte o iPhone pelo cabo;
   - na tela do aparelho, clique no número de série até aparecer o **UDID**, e copie.
3. **Devices → +**: registre o iPhone com esse UDID.
4. **Profiles → + → Ad Hoc**:
   - escolha o App ID, o certificado e o seu iPhone;
   - nome `Mesa Viva Ad Hoc`;
   - baixe o `.mobileprovision`.
   - Se trocar de iPhone ou incluir outro aparelho, gere o perfil de novo.

## 4. Ajustes do projeto para iOS (no Unity)

**Edit → Project Settings → Player → aba iOS:**

| Campo | Valor |
|---|---|
| Company Name / Product Name | o seu nome / `Mesa Viva` |
| **Bundle Identifier** | exatamente o do App ID (`com.SEUNOME.mesaviva`) |
| Version / Build | `0.1.0` / `1` (aumente o Build a cada envio) |
| **Camera Usage Description** | `A câmera é usada para ver a mesa e reconhecer as cartas. O vídeo não sai do seu iPhone.` **Sem isso o app fecha ao abrir.** |
| Target minimum iOS Version | o que a Project Validation do XR pedir |
| Architecture | ARM64 |
| Automatically Sign | **desligado** (quem assina é a nuvem, com o `.p12` e o perfil) |

Em **XR Plug-in Management → Apple ARKit**, deixe *Requirement* = **Required**.

Depois: **commit + push**.

## 5. Unity Build Automation

1. **Edit → Project Settings → Services**: ligue o projeto a uma organização da **Unity Cloud** (crie uma, se precisar).
2. Em https://cloud.unity.com → **DevOps → Build Automation**: **Set up / Configure**.
   - **Source control:** GitHub → autorize → repositório `mesa-viva`, branch `main`.
   - **Project subfolder:** `unity-app` (o projeto Unity não fica na raiz do repositório).
   - **Target:** iOS, **Unity version** = a mesma que você usa, Xcode = a sugerida.
   - **Credentials:** envie o `.p12` (com a senha) e o `.mobileprovision`.
3. **Start build.** Leva de 15 a 30 min, e a primeira vez é mais lenta.
4. **Custo:** o Build Automation cobra pelos minutos de Mac usados. Veja o preço atual na página de faturamento e **defina um limite de gasto**.

## 6. Instalar no iPhone

1. Quando o build terminar, abra a página dele e use **Share** / **Install**. Abra o link no **Safari do iPhone** e confirme a instalação.
2. Na primeira vez, no iOS 16 ou mais novo: **Ajustes → Privacidade e Segurança → Modo de Desenvolvedor → Ativar** e reinicie o iPhone.
3. Abra o **Mesa Viva**. O pedido de câmera aparece com o texto do passo 4.

## 7. Economizando builds

Cada build custa tempo e dinheiro. Então:
- **Teste o máximo no Editor:**
  - **Device Simulator** para as telas (notch, tamanhos);
  - **XR Simulation** para a calibração da mesa (`MESA_GUIA.md` §6).
- **Junte várias mudanças** antes de cada build.
- Opcional: o asset pago **AR Foundation Remote** transmite o ARKit do iPhone para o Editor no PC. Exige um build do app companheiro uma única vez.

## 8. LiDAR (iPhone 12 Pro ou mais novo)

O seu iPhone tem LiDAR. Com ele, o ARKit encontra mesas lisas em cerca de 1 segundo e dá para esconder as criaturas atrás das mãos (oclusão por profundidade). Isso vira a qualidade **Alta** do app numa fase seguinte. Não precisa configurar nada agora.

## 9. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Build falha em *code signing* | O perfil não tem o certificado, ou o Bundle ID está diferente | Gere o perfil escolhendo o mesmo certificado do `.p12`. Confira o Bundle ID nos dois lados. |
| Build falha com erro de `.p12` | Formato do `.p12` | Gere de novo com `-legacy` (§2). |
| "Não foi possível instalar o app" | O UDID do iPhone não está no perfil | §3: registre o aparelho, gere o perfil de novo, atualize a credencial e faça outro build. |
| App instala mas não abre | Modo de Desenvolvedor desligado | §6.2 |
| App fecha logo depois de abrir | Falta a *Camera Usage Description* | §4 |
| Câmera preta | Falta o AR Background Renderer Feature | `COMECE_AQUI.md` §5 |
| O build na nuvem não acha o projeto | *Project subfolder* errado | Tem que ser `unity-app`. |
