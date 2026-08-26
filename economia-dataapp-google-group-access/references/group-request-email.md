# Email template — Google setup request to Economia IT

To: `pocitace@economia.cz`

Two independent asks can go to the same person (Radek) — a new Google Group,
a new OAuth redirect URI, or both for the same app. Keep the two sections
below separate in the email (they're unrelated Google systems — Groups vs.
the GCP-project OAuth Client) and just delete whichever section isn't
needed.

---

Subject: Nastavení pro Keboola data app `<app_name>` — {skupina / redirect URI / obojí}

Dobrý den,

potřebovali bychom nastavit přístup pro novou Keboola data appku
`<app_name>` (`<deployment_url>`).

### A) Založení Google skupiny — *zahrň, pokud cílová skupina ještě neexistuje*

Potřebovali bychom založit novou Google skupinu pro ověřování přístupu k
reportu — stejným způsobem, jak už máme skupinu `dataapps_product@economia.cz`
(Dataapps Product).

**Název skupiny:** `dataapps_<team>@economia.cz`

**Popis:** Skupina/Ověření pro google ověření přihlášení do reportů

**Správci (Manager/Owner) při založení:**
- pavel.stepanek@economia.cz
- martin.sedlacek@economia.cz
- vit.svoboda@economia.cz
- analytici@economia.cz (distribuční skupina)
- keboola-group-check@keboola-sso.iam.gserviceaccount.com

Zbytek uživatelů (kdo report skutečně uvidí) doplníme sami po založení, není
potřeba je řešit při zakládání.

### B) Přidání redirect URI na sdílený OAuth Client — *zahrň, pokud appka ještě není na Clientu*

V Google Cloud Console, na projektu, který vlastní náš sdílený OAuth Client
(ten používaný pro Google SSO login do Keboola data apps), prosím přidej
tuhle URL do **Authorized redirect URIs**:

```
<deployment_url>/_proxy/callback
```

Nový Client prosím nezakládej — jde jen o přidání URI na ten stávající
sdílený.

---

Díky moc,
Pavel

---

Notes for whoever sends this:
- Replace `<app_name>` and `<deployment_url>` (e.g.
  `https://subscription-command-center-985851361.hub.eu-central-1.keboola.com`).
- Replace `<team>` in section A with the actual team/report name (e.g.
  `yield`, `finance`) — drop section A entirely if the group already exists.
- Drop section B entirely if the app is reusing a group/Client combo that's
  already wired up (e.g. adding a second report under an existing group and
  existing deployment).
- Double-check the `analytici@economia.cz` address is the right distribution
  alias before sending.
- The service account address in section A must be included exactly as
  shown — that's what lets the app's middleware check membership (see
  SKILL.md Gotcha 1).
