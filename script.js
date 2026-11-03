// ==========================================
// MYFINANCE PRO
// Local multi-user finance dashboard
// ==========================================

const USERS_KEY = "myFinanceUsers";
const LAST_USER_KEY = "myFinanceLastUser";
const SESSION_KEY = "myFinanceCurrentUser";

const $ = id => document.getElementById(id);

let currentUser = null;
let data = { accounts: [], transactions: [] };
let activeAccountId = null;
let editingAccountId = null;
let editingTransactionId = null;
let pinInput = "";
let marketTimer = null;

const chartColors = [
  "#35d6a0",
  "#5d9cff",
  "#b18aff",
  "#ffad45",
  "#ff6478",
  "#45c7d9"
];

const pageNames = {
  dashboard: "Dashboard",
  accounts: "Accounts",
  accountDetail: "Account Details",
  transactions: "Transactions",
  settings: "Settings"
};


// ==========================================
// STORAGE AND SECURITY
// ==========================================

function readUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function userKey(username) {
  return username.trim().toLowerCase();
}

function makeSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  return Array.from(
    bytes,
    b => b.toString(16).padStart(2, "0")
  ).join("");
}

async function hashSecret(secret, salt) {
  if (!crypto.subtle) {
    throw new Error("Secure hashing requires localhost or HTTPS.");
  }

  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: new TextEncoder().encode(salt),
    iterations: 150000,
    hash: "SHA-256"
  }, material, 256);

  return Array.from(
    new Uint8Array(bits),
    b => b.toString(16).padStart(2, "0")
  ).join("");
}

async function verifySecret(secret, salt, expected) {
  return await hashSecret(secret, salt) === expected;
}

function getUserRecord() {
  return readUsers()[userKey(currentUser)] || null;
}

function saveUserData() {
  if (!currentUser) return;

  const users = readUsers();
  const key = userKey(currentUser);

  if (!users[key]) return;

  users[key].data = data;
  saveUsers(users);
}

function loadUserData() {
  const record = getUserRecord();

  data = record?.data || {
    accounts: [],
    transactions: []
  };

  if (!Array.isArray(data.accounts)) {
    data.accounts = [];
  }

  if (!Array.isArray(data.transactions)) {
    data.transactions = [];
  }

  // Preserve compatibility with older transaction formats.
  data.transactions.forEach(t => {
    if (t.type === "income") t.type = "deposit";
    if (t.type === "expense") t.type = "withdraw";
  });

  saveUserData();
}

function showToast(message) {
  const toast = $("toast");

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2700);
}

function showPanel(panelId) {
  ["signupPanel", "loginPanel", "pinPanel"].forEach(id => {
    $(id).classList.toggle("hidden", id !== panelId);
  });

  $("authScreen").classList.remove("hidden");
  $("app").classList.add("hidden");
}

function showApp() {
  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");

  $("sidebarUsername").textContent = currentUser;

  renderAll();
  startMarketTimer();
}


// ==========================================
// AUTHENTICATION
// ==========================================

async function startApp() {
  const users = readUsers();
  const lastUser = localStorage.getItem(LAST_USER_KEY);

  if (!Object.keys(users).length) {
    showPanel("signupPanel");
    return;
  }

  if (lastUser && users[lastUser]) {
    currentUser = lastUser;

    $("pinUsername").textContent = currentUser;

    resetPinDisplay();
    showPanel("pinPanel");
  } else {
    showPanel("loginPanel");
  }
}

$("showLogin").addEventListener("click", e => {
  e.preventDefault();
  showPanel("loginPanel");
});

$("showSignup").addEventListener("click", e => {
  e.preventDefault();
  showPanel("signupPanel");
});

$("signupForm").addEventListener("submit", async e => {
  e.preventDefault();

  const username = $("newUsername").value.trim();
  const password = $("newPassword").value;
  const confirm = $("confirmPassword").value;
  const pin = $("newPin").value;

  if (username.length < 3) {
    return showToast("Username must have at least 3 characters.");
  }

  if (password.length < 6) {
    return showToast("Password must have at least 6 characters.");
  }

  if (password !== confirm) {
    return showToast("Passwords do not match.");
  }

  if (!/^\d{4}$/.test(pin)) {
    return showToast("PIN must contain exactly 4 digits.");
  }

  const users = readUsers();
  const key = userKey(username);

  if (users[key]) {
    return showToast("This username already exists.");
  }

  try {
    const passwordSalt = makeSalt();
    const pinSalt = makeSalt();

    users[key] = {
      username,
      passwordSalt,
      passwordHash: await hashSecret(password, passwordSalt),
      pinSalt,
      pinHash: await hashSecret(pin, pinSalt),
      data: {
        accounts: [],
        transactions: []
      }
    };

    saveUsers(users);

    currentUser = key;

    localStorage.setItem(LAST_USER_KEY, key);
    localStorage.setItem(SESSION_KEY, key);

    data = {
      accounts: [],
      transactions: []
    };

    $("signupForm").reset();

    showApp();
    showToast("Account created successfully.");

  } catch (error) {
    showToast(error.message || "Could not create account.");
  }
});

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const username = userKey($("loginUsername").value);
  const password = $("loginPassword").value;

  const record = readUsers()[username];

  if (!record) {
    return showToast("Account not found.");
  }

  try {
    const valid = await verifySecret(
      password,
      record.passwordSalt,
      record.passwordHash
    );

    if (!valid) {
      return showToast("Incorrect password.");
    }

    currentUser = username;

    localStorage.setItem(LAST_USER_KEY, username);
    localStorage.setItem(SESSION_KEY, username);

    $("loginForm").reset();
    $("pinUsername").textContent = username;

    resetPinDisplay();
    showPanel("pinPanel");

    $("pinMessage").textContent = "Enter your 4-digit PIN";

  } catch (error) {
    showToast(error.message || "Login failed.");
  }
});


// ==========================================
// PIN SCREEN
// ==========================================

function resetPinDisplay() {
  pinInput = "";

  $("pinDots").classList.remove("success");

  $("pinDots").querySelectorAll("span").forEach(dot => {
    dot.classList.remove("filled");
  });

  $("pinMessage").textContent = "Enter your 4-digit PIN";
  $("pinMessage").classList.remove("error");
}

function updatePinDots() {
  $("pinDots").querySelectorAll("span").forEach((dot, index) => {
    dot.classList.toggle("filled", index < pinInput.length);
  });
}

async function checkPin() {
  const record = getUserRecord();

  if (!record) {
    switchAccount();
    return;
  }

  try {
    const valid = await verifySecret(
      pinInput,
      record.pinSalt,
      record.pinHash
    );

    if (valid) {
      $("pinDots").classList.add("success");

      $("pinMessage").textContent = "Unlocked!";
      $("pinMessage").classList.remove("error");

      loadUserData();

      localStorage.setItem(SESSION_KEY, currentUser);

      setTimeout(() => {
        showApp();
        resetPinDisplay();
      }, 450);

    } else {
      $("pinMessage").textContent = "Incorrect PIN. Try again.";
      $("pinMessage").classList.add("error");

      setTimeout(resetPinDisplay, 650);
    }

  } catch (error) {
    showToast(error.message || "PIN verification failed.");
  }
}

document.querySelectorAll(".key").forEach(button => {
  button.addEventListener("click", () => {
    const key = button.dataset.key;

    if (key === "switch") {
      return switchAccount();
    }

    if (key === "delete") {
      pinInput = pinInput.slice(0, -1);
      updatePinDots();
      return;
    }

    if (!/^\d$/.test(key) || pinInput.length >= 4) {
      return;
    }

    pinInput += key;

    updatePinDots();

    if (pinInput.length === 4) {
      checkPin();
    }
  });
});

$("forgotPin").addEventListener("click", () => {
  showToast("Use Switch Account to sign in with your password.");
});

$("pinSwitchAccount").addEventListener("click", switchAccount);

function switchAccount() {
  currentUser = null;

  localStorage.removeItem(LAST_USER_KEY);
  localStorage.removeItem(SESSION_KEY);

  if (marketTimer) {
    clearInterval(marketTimer);
  }

  $("loginForm").reset();

  showPanel("loginPanel");
}


// ==========================================
// LOCK AND SETTINGS
// ==========================================

function lockApp() {
  if (!currentUser) return;

  saveUserData();

  localStorage.removeItem(SESSION_KEY);

  if (marketTimer) {
    clearInterval(marketTimer);
  }

  $("pinUsername").textContent = currentUser;

  resetPinDisplay();
  showPanel("pinPanel");
}

$("logoutBtn").addEventListener("click", lockApp);
$("lockNowBtn").addEventListener("click", lockApp);

$("settingsLogoutBtn").addEventListener("click", switchAccount);
$("settingsSwitchBtn").addEventListener("click", switchAccount);

$("changePinBtn").addEventListener("click", () => {
  $("pinForm").reset();
  openModal("pinModal");
});

$("pinForm").addEventListener("submit", async e => {
  e.preventDefault();

  const oldPin = $("currentPin").value;
  const newPin = $("replacementPin").value;
  const confirm = $("confirmReplacementPin").value;

  const record = getUserRecord();

  if (!/^\d{4}$/.test(newPin)) {
    return showToast("PIN must contain 4 digits.");
  }

  if (newPin !== confirm) {
    return showToast("New PINs do not match.");
  }

  try {
    const valid = await verifySecret(
      oldPin,
      record.pinSalt,
      record.pinHash
    );

    if (!valid) {
      return showToast("Current PIN is incorrect.");
    }

    const users = readUsers();
    const key = userKey(currentUser);

    users[key].pinSalt = makeSalt();

    users[key].pinHash = await hashSecret(
      newPin,
      users[key].pinSalt
    );

    saveUsers(users);

    closeModal("pinModal");
    $("pinForm").reset();

    showToast("PIN updated successfully.");

  } catch (error) {
    showToast(error.message || "Could not update PIN.");
  }
});


// ==========================================
// NAVIGATION
// ==========================================

document.querySelectorAll(".nav-link[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

function openPage(page) {
  document.querySelectorAll(".page").forEach(section => {
    section.classList.remove("active");
  });

  document.querySelectorAll(".nav-link[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  $(`${page}Page`).classList.add("active");

  $("pageTitle").textContent = pageNames[page] || "Dashboard";
}

function openAccountDetail(id) {
  const account = data.accounts.find(a => a.id === id);

  if (!account) return;

  activeAccountId = id;

  renderAccountDetail();

  document.querySelectorAll(".page").forEach(section => {
    section.classList.remove("active");
  });

  $("accountDetailPage").classList.add("active");

  $("pageTitle").textContent = "Account Details";

  document.querySelectorAll(".nav-link[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === "accounts"
    );
  });
}

$("backToAccounts").addEventListener("click", () => {
  openPage("accounts");
});


// ==========================================
// FINANCE HELPERS
// ==========================================

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function money(value, currency) {
  const amount = Number(value) || 0;

  const actualCurrency = currency === "Toman"
    ? "IRR"
    : currency;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: actualCurrency,
      maximumFractionDigits: 2
    }).format(currency === "Toman" ? amount * 10 : amount);

  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}

function number(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2
  });
}

function accountBalance(account) {
  let balance = Number(account.initialBalance) || 0;

  data.transactions
    .filter(t => t.accountId === account.id)
    .forEach(t => {
      const amount = Number(t.amount) || 0;

      if (["deposit", "trade-profit"].includes(t.type)) {
        balance += amount;
      }

      if (["withdraw", "trade-loss"].includes(t.type)) {
        balance -= amount;
      }
    });

  return balance;
}

function sumTypes(transactions, types) {
  return transactions
    .filter(t => types.includes(t.type))
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
}

function accountTransactions(accountId) {
  return data.transactions.filter(t => t.accountId === accountId);
}

function getPeriodTransactions(period) {
  const now = new Date();
  const start = new Date(now);

  if (period === "week") {
    const day = (now.getDay() + 6) % 7;

    start.setDate(now.getDate() - day);

  } else if (period === "month") {
    start.setDate(1);

  } else {
    return data.transactions;
  }

  start.setHours(0, 0, 0, 0);

  return data.transactions.filter(t => {
    const date = new Date(`${t.date}T00:00:00`);

    return !Number.isNaN(date.getTime()) &&
      date >= start &&
      date <= now;
  });
}

function getPreviousMonthTransactions() {
  const now = new Date();

  const start = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  );

  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );

  return data.transactions.filter(t => {
    const date = new Date(`${t.date}T00:00:00`);

    return date >= start && date < end;
  });
}

function netTrading(transactions) {
  return sumTypes(transactions, ["trade-profit"]) -
    sumTypes(transactions, ["trade-loss"]);
}


// ==========================================
// RENDER ALL
// ==========================================

function renderAll() {
  renderDashboard();
  renderAccounts();
  renderTransactions();
  renderSidebarAccounts();
  fillTransactionAccounts();
}


// ==========================================
// DASHBOARD
// ==========================================

function renderDashboard() {
  const currencies = {};

  data.accounts.forEach(account => {
    const currency = account.currency;

    currencies[currency] =
      (currencies[currency] || 0) + accountBalance(account);
  });

  const currencyEntries = Object.entries(currencies);

  $("totalBalance").textContent = currencyEntries.length
    ? currencyEntries.map(([currency, total]) =>
        money(total, currency)
      ).join(" · ")
    : "$0.00";

  $("totalAccounts").textContent = data.accounts.length;

  const week = getPeriodTransactions("week");

  const weekProfit = sumTypes(week, ["trade-profit"]);
  const weekLoss = sumTypes(week, ["trade-loss"]);

  $("weeklyProfit").textContent = number(weekProfit);
  $("weeklyLoss").textContent = number(weekLoss);

  renderCapitalChart();
  renderPnL();
  renderDashboardAccounts();
}

function renderCapitalChart() {
  const chart = $("capitalChart");
  const legend = $("capitalLegend");

  const validAccounts = data.accounts.map((account, index) => ({
    account,
    balance: Math.max(0, accountBalance(account)),
    color: chartColors[index % chartColors.length]
  }));

  const total = validAccounts.reduce(
    (sum, item) => sum + item.balance,
    0
  );

  $("chartTotal").textContent = total
    ? number(total)
    : "No accounts";

  if (!validAccounts.length || total <= 0) {
    chart.style.background =
      "conic-gradient(#344454 0deg 360deg)";

    legend.innerHTML =
      `<p class="muted">Add accounts to see your capital distribution.</p>`;

    return;
  }

  let angle = 0;
  const segments = [];

  validAccounts.forEach(item => {
    const degrees = item.balance / total * 360;

    segments.push(
      `${item.color} ${angle}deg ${angle + degrees}deg`
    );

    angle += degrees;
  });

  chart.style.background =
    `conic-gradient(${segments.join(",")})`;

  legend.innerHTML = validAccounts.map(item => {
    const percentage = item.balance / total * 100;

    return `
      <div class="legend-item">
        <span class="legend-dot"
          style="--legend-color:${item.color}"></span>

        <span>
          ${escapeHTML(item.account.name)}
          <small>${percentage.toFixed(1)}%</small>
        </span>

        <strong>${number(item.balance)}</strong>
      </div>
    `;
  }).join("");
}

function renderPnL() {
  const period = $("pnlPeriod").value;

  const transactions = getPeriodTransactions(period);

  const profit = sumTypes(transactions, ["trade-profit"]);
  const loss = sumTypes(transactions, ["trade-loss"]);

  const net = profit - loss;
  const total = Math.max(profit, loss, 1);

  $("periodNet").textContent = number(net);

  $("periodNet").className = net >= 0
    ? "green-text"
    : "red-text";

  $("periodProfit").textContent = number(profit);
  $("periodLoss").textContent = number(loss);

  $("profitBar").style.width =
    `${profit / total * 100}%`;

  $("lossBar").style.width =
    `${loss / total * 100}%`;

  $("periodStatus").textContent = net > 0
    ? "Profit"
    : net < 0
      ? "Loss"
      : "Break Even";

  const previous = getPreviousMonthTransactions();

  const previousNet = netTrading(previous);

  const currentNet = netTrading(
    getPeriodTransactions("month")
  );

  let growth = "—";

  if (previousNet !== 0) {
    growth =
      `${((currentNet - previousNet) /
        Math.abs(previousNet) * 100).toFixed(1)}%`;

  } else if (currentNet > 0) {
    growth = "New Profit";
  }

  $("monthlyGrowth").textContent = growth;
}

$("pnlPeriod").addEventListener("change", renderPnL);

function renderDashboardAccounts() {
  $("dashboardAccounts").innerHTML = data.accounts.length
    ? data.accounts.map((account, index) => `
        <button class="dashboard-account"
          style="--account-color:${chartColors[index % chartColors.length]}"
          data-account="${account.id}">

          <span class="account-dot"></span>

          ${escapeHTML(account.type)}

          <strong>${escapeHTML(account.name)}</strong>

          <small>${escapeHTML(account.currency)}</small>

          <b>${money(accountBalance(account), account.currency)}</b>
        </button>
      `).join("")
    : `<p class="muted">No accounts yet. Create your first account.</p>`;
}


// ==========================================
// ACCOUNT MANAGEMENT AND DETAILS
// ==========================================

function renderAccounts() {
  $("allAccounts").innerHTML = data.accounts.length
    ? data.accounts.map((account, index) => `
        <article class="widget account-card"
          data-account="${account.id}"
          style="--account-color:${chartColors[index % chartColors.length]}">

          <h3>${escapeHTML(account.name)}</h3>

          <p>
            ${escapeHTML(account.type)}
            ·
            ${escapeHTML(account.currency)}
          </p>

          <h2>${money(accountBalance(account), account.currency)}</h2>

          <button class="small-btn edit-account"
            data-id="${account.id}">
            Edit
          </button>

          <button class="danger-btn delete-account"
            data-id="${account.id}">
            Delete
          </button>

        </article>
      `).join("")
    : `<p class="muted">No accounts created yet.</p>`;
}

function renderSidebarAccounts() {
  $("sidebarAccounts").innerHTML = data.accounts.map((account, index) => `
      <button class="side-account" data-account="${account.id}">

        <span class="side-account-dot"
          style="--account-color:${chartColors[index % chartColors.length]}">
        </span>

        <span>${escapeHTML(account.name)}</span>

      </button>
    `).join("");
}

function renderAccountDetail() {
  const account = data.accounts.find(
    a => a.id === activeAccountId
  );

  if (!account) return;

  const transactions = accountTransactions(account.id);

  const deposits = sumTypes(transactions, ["deposit"]);
  const withdrawals = sumTypes(transactions, ["withdraw"]);
  const profit = sumTypes(transactions, ["trade-profit"]);
  const loss = sumTypes(transactions, ["trade-loss"]);

  $("detailAccountName").textContent = account.name;
  $("detailAccountType").textContent = account.type;

  $("detailBalance").textContent =
    money(accountBalance(account), account.currency);

  $("detailCurrency").textContent = account.currency;

  $("detailDeposits").textContent =
    money(deposits, account.currency);

  $("detailWithdrawals").textContent =
    money(withdrawals, account.currency);

  $("detailProfit").textContent =
    money(profit, account.currency);

  $("detailLoss").textContent =
    money(loss, account.currency);

  const list = [...transactions].sort(
    (a, b) => b.date.localeCompare(a.date)
  );

  $("detailTransactionsList").innerHTML =
    list.map(t => transactionHTML(t)).join("");

  $("detailEmptyMessage").classList.toggle(
    "hidden",
    list.length > 0
  );
}

$("detailAddTransaction").addEventListener("click", () => {
  openTransactionModal(activeAccountId);
});

$("dashboardAddAccount").addEventListener("click", () => {
  openAccountModal();
});

$("addAccountBtn").addEventListener("click", () => {
  openAccountModal();
});

$("quickAddAccount").addEventListener("click", () => {
  openAccountModal();
});


// ==========================================
// TRANSACTIONS
// ==========================================

function transactionHTML(t) {
  const account = data.accounts.find(
    a => a.id === t.accountId
  );

  const currency = account?.currency || "USD";

  const positive = [
    "deposit",
    "trade-profit"
  ].includes(t.type);

  const sign = positive ? "+" : "−";

  const labels = {
    deposit: "Deposit",
    withdraw: "Withdrawal",
    "trade-profit": "Trading Profit",
    "trade-loss": "Trading Loss"
  };

  return `
    <div class="transaction-item">

      <div class="transaction-info">

        <strong>${escapeHTML(t.title)}</strong>

        <small>
          ${escapeHTML(t.date)}
          ·
          ${escapeHTML(account?.name || "Deleted account")}
        </small>

        <small>
          ${labels[t.type] || escapeHTML(t.type)}
          ${t.description
            ? " · " + escapeHTML(t.description)
            : ""}
        </small>

      </div>

      <strong class="transaction-amount ${positive ? "positive" : "negative"}">
        ${sign}${money(t.amount, currency)}
      </strong>

      <div class="transaction-actions">

        <button class="icon-btn edit-transaction"
          data-id="${t.id}">
          Edit
        </button>

        <button class="icon-btn delete-transaction"
          data-id="${t.id}">
          ×
        </button>

      </div>

    </div>
  `;
}

function renderTransactions() {
  const search = $("transactionSearch").value.toLowerCase();
  const filter = $("transactionFilter").value;

  const list = [...data.transactions]
    .filter(t => {
      const account = data.accounts.find(
        a => a.id === t.accountId
      );

      const matchesSearch =
        t.title.toLowerCase().includes(search) ||
        (t.description || "").toLowerCase().includes(search) ||
        (account?.name || "").toLowerCase().includes(search);

      return matchesSearch &&
        (filter === "all" || t.type === filter);
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  $("allTransactions").innerHTML =
    list.map(transactionHTML).join("");

  $("emptyMessage").classList.toggle(
    "hidden",
    list.length > 0
  );
}

$("transactionSearch").addEventListener("input", renderTransactions);

$("transactionFilter").addEventListener("change", renderTransactions);

function fillTransactionAccounts() {
  $("transactionAccount").innerHTML = data.accounts.map(account =>
    `<option value="${account.id}">
      ${escapeHTML(account.name)} (${account.currency})
    </option>`
  ).join("");
}


// ==========================================
// MODALS AND FORMS
// ==========================================

function openModal(id) {
  $(id).classList.remove("hidden");
}

function closeModal(id) {
  $(id).classList.add("hidden");
}

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    closeModal(button.dataset.close);
  });
});

function openAccountModal(accountId = null) {
  editingAccountId = accountId;

  $("accountForm").reset();

  $("accountModalTitle").textContent =
    accountId ? "Edit Account" : "Add Account";

  if (accountId) {
    const account = data.accounts.find(
      a => a.id === accountId
    );

    if (!account) return;

    $("accountName").value = account.name;
    $("accountType").value = account.type;
    $("accountCurrency").value = account.currency;
    $("initialBalance").value = account.initialBalance;
  }

  openModal("accountModal");
}

$("accountForm").addEventListener("submit", e => {
  e.preventDefault();

  const accountData = {
    name: $("accountName").value.trim(),
    type: $("accountType").value,
    currency: $("accountCurrency").value,
    initialBalance: Number($("initialBalance").value) || 0
  };

  if (editingAccountId) {
    const account = data.accounts.find(
      a => a.id === editingAccountId
    );

    if (account) {
      Object.assign(account, accountData);
    }

  } else {
    data.accounts.push({
      id: makeId(),
      ...accountData
    });
  }

  saveUserData();

  closeModal("accountModal");

  renderAll();

  if (activeAccountId) {
    renderAccountDetail();
  }

  showToast(
    editingAccountId
      ? "Account updated."
      : "Account created."
  );

  editingAccountId = null;
});

function openTransactionModal(
  accountId = null,
  transactionId = null
) {
  if (!data.accounts.length) {
    showToast("Create an account first.");

    openPage("accounts");

    return;
  }

  editingTransactionId = transactionId;

  $("transactionForm").reset();

  fillTransactionAccounts();

  $("transactionModalTitle").textContent =
    transactionId
      ? "Edit Transaction"
      : "Add Transaction";

  $("transactionDate").value =
    new Date().toISOString().slice(0, 10);

  if (transactionId) {
    const t = data.transactions.find(
      x => x.id === transactionId
    );

    if (!t) return;

    $("transactionTitle").value = t.title;
    $("transactionAccount").value = t.accountId;
    $("transactionType").value = t.type;
    $("transactionAmount").value = t.amount;
    $("transactionDate").value = t.date;
    $("transactionDescription").value =
      t.description || "";

  } else if (accountId) {
    $("transactionAccount").value = accountId;
  }

  openModal("transactionModal");
}

$("topAddTransaction").addEventListener("click", () => {
  openTransactionModal();
});

$("addTransactionBtn").addEventListener("click", () => {
  openTransactionModal();
});

$("quickAddTransaction").addEventListener("click", () => {
  openTransactionModal();
});

$("transactionForm").addEventListener("submit", e => {
  e.preventDefault();

  const amount = Number($("transactionAmount").value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return showToast("Enter a valid amount.");
  }

  const transactionData = {
    title: $("transactionTitle").value.trim(),
    accountId: $("transactionAccount").value,
    type: $("transactionType").value,
    amount,
    date: $("transactionDate").value,
    description: $("transactionDescription").value.trim()
  };

  if (editingTransactionId) {
    const t = data.transactions.find(
      x => x.id === editingTransactionId
    );

    if (t) {
      Object.assign(t, transactionData);
    }

  } else {
    data.transactions.push({
      id: makeId(),
      ...transactionData
    });
  }

  saveUserData();

  closeModal("transactionModal");

  renderAll();

  if (activeAccountId) {
    renderAccountDetail();
  }

  showToast(
    editingTransactionId
      ? "Transaction updated."
      : "Transaction saved."
  );

  editingTransactionId = null;
});


// ==========================================
// CLICK ACTIONS
// ==========================================

document.addEventListener("click", e => {
  const accountButton = e.target.closest("[data-account]");

  const editAccountButton = e.target.closest(".edit-account");
  const deleteAccountButton = e.target.closest(".delete-account");

  const editTransactionButton = e.target.closest(".edit-transaction");
  const deleteTransactionButton = e.target.closest(".delete-transaction");

  if (editAccountButton) {
    e.stopPropagation();

    openAccountModal(editAccountButton.dataset.id);

    return;
  }

  if (deleteAccountButton) {
    e.stopPropagation();

    const id = deleteAccountButton.dataset.id;

    if (!confirm("Delete this account and its transactions?")) {
      return;
    }

    data.accounts = data.accounts.filter(
      a => a.id !== id
    );

    data.transactions = data.transactions.filter(
      t => t.accountId !== id
    );

    if (activeAccountId === id) {
      activeAccountId = null;
      openPage("accounts");
    }

    saveUserData();

    renderAll();

    showToast("Account deleted.");

    return;
  }

  if (editTransactionButton) {
    e.stopPropagation();

    openTransactionModal(
      null,
      editTransactionButton.dataset.id
    );

    return;
  }

  if (deleteTransactionButton) {
    e.stopPropagation();

    const id = deleteTransactionButton.dataset.id;

    if (!confirm("Delete this transaction?")) {
      return;
    }

    data.transactions = data.transactions.filter(
      t => t.id !== id
    );

    saveUserData();

    renderAll();

    if (activeAccountId) {
      renderAccountDetail();
    }

    showToast("Transaction deleted.");

    return;
  }

  if (accountButton) {
    openAccountDetail(accountButton.dataset.account);
  }
});


// ==========================================
// MARKET DATA
// ==========================================

function setMarketPrice(id, value, currency) {
  $(id).textContent = value == null
    ? "Unavailable"
    : `${currency} ${Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 2
      })}`;
}

function setMarketChange(id, value) {
  const element = $(id);

  if (value == null || !Number.isFinite(Number(value))) {
    element.textContent = "Change unavailable";
    element.className = "market-change";

    return;
  }

  const change = Number(value);

  element.textContent =
    `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;

  element.className =
    `market-change ${change >= 0 ? "up" : "down"}`;
}

async function fetchCryptoPrices() {
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true",
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Crypto service unavailable");
  }

  const result = await response.json();

  if (!result.bitcoin || !result.ethereum) {
    throw new Error("Incomplete crypto prices");
  }

  setMarketPrice("btcPrice", result.bitcoin.usd, "$");

  setMarketChange(
    "btcChange",
    result.bitcoin.usd_24h_change
  );

  setMarketPrice("ethPrice", result.ethereum.usd, "$");

  setMarketChange(
    "ethChange",
    result.ethereum.usd_24h_change
  );
}

async function fetchDollarPrice() {
  // This public data source may change its format or become unavailable.
  const response = await fetch(
    "https://raw.githubusercontent.com/iran-market/iran-market.github.io/main/data/popular.json",
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Dollar service unavailable");
  }

  const result = await response.json();

  const items = Array.isArray(result)
    ? result
    : Object.values(result).flatMap(value =>
        Array.isArray(value) ? value : [value]
      );

  const dollar = items.find(item =>
    item && (
      item.symbol === "USD_IRR_FREE" ||
      item.symbol === "USD"
    )
  );

  if (!dollar || !Number(dollar.price)) {
    throw new Error("Dollar price not found");
  }

  const priceInToman = Number(dollar.price) / 10;

  setMarketPrice("usdPrice", priceInToman, "T");

  setMarketChange("usdChange", dollar.change_pct);
}

async function refreshMarketPrices() {
  $("marketUpdated").textContent = "Updating prices...";

  $("refreshMarket").disabled = true;
  $("topRefreshMarket").disabled = true;

  const results = await Promise.allSettled([
    fetchDollarPrice(),
    fetchCryptoPrices()
  ]);

  const dollarOk = results[0].status === "fulfilled";
  const cryptoOk = results[1].status === "fulfilled";

  if (!dollarOk) {
    setMarketPrice("usdPrice", null, "");
    setMarketChange("usdChange", null);
  }

  if (!cryptoOk) {
    setMarketPrice("btcPrice", null, "");
    setMarketPrice("ethPrice", null, "");

    setMarketChange("btcChange", null);
    setMarketChange("ethChange", null);
  }

  const time = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  });

  $("marketUpdated").textContent =
    `Last update: ${time} · ${
      dollarOk || cryptoOk
        ? "Partial or complete data"
        : "Connection failed"
    }`;

  $("refreshMarket").disabled = false;
  $("topRefreshMarket").disabled = false;
}

function startMarketTimer() {
  if (marketTimer) {
    clearInterval(marketTimer);
  }

  refreshMarketPrices();

  marketTimer = setInterval(
    refreshMarketPrices,
    60000
  );
}

$("refreshMarket").addEventListener("click", refreshMarketPrices);
$("topRefreshMarket").addEventListener("click", refreshMarketPrices);


// ==========================================
// UTILITIES
// ==========================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}


// ==========================================
// SAVE CHANGES
// ==========================================

window.addEventListener("beforeunload", () => {
  if (currentUser) {
    saveUserData();
  }
});


// ==========================================
// START APPLICATION
// ==========================================

startApp();


// ==========================================
// SERVICE WORKER REGISTRATION
// ==========================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "./service-worker.js"
      );

      console.log(
        "Service Worker registered:",
        registration.scope
      );

    } catch (error) {
      console.error(
        "Service Worker registration failed:",
        error
      );
    }
  });
}