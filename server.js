// =====================================================
// VIBECASH FOOD GAME SERVER
// RENDER + NODE.JS + EXPRESS + FIREBASE ADMIN
// SERVER AUTHORITATIVE VERSION
// =====================================================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// =====================================================
// ENVIRONMENT
// =====================================================

const PORT = process.env.PORT || 10000;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!FIREBASE_DATABASE_URL) {
    console.error("FIREBASE_DATABASE_URL is missing");
    process.exit(1);
}

if (!FIREBASE_SERVICE_ACCOUNT) {
    console.error("FIREBASE_SERVICE_ACCOUNT is missing");
    process.exit(1);
}

// =====================================================
// SERVICE ACCOUNT
// =====================================================

let serviceAccount;

try {
    serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
} catch (error) {
    console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON");
    console.error(error.message);
    process.exit(1);
}

if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
) {
    console.error("Firebase service account is incomplete");
    process.exit(1);
}

serviceAccount.private_key = String(serviceAccount.private_key)
    .replace(/\\n/g, "\n");

// =====================================================
// FIREBASE ADMIN
// =====================================================

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: FIREBASE_DATABASE_URL
    });
} catch (error) {
    console.error("Firebase initialization failed");
    console.error(error);
    process.exit(1);
}

const db = admin.database();

// =====================================================
// GAME CONFIG
// =====================================================

const BET_DURATION = 30 * 1000;
const SPIN_DURATION = 5 * 1000;
const SHOW_DURATION = 4 * 1000;

// =====================================================
// FOOD CONFIG
// =====================================================

const FOODS = [
    { index: 0, key: "apple",      name: "Apple",      multiplier: 5,  weight: 20 },
    { index: 1, key: "mango",      name: "Mango",      multiplier: 5,  weight: 20 },
    { index: 2, key: "strawberry", name: "Strawberry", multiplier: 5,  weight: 20 },
    { index: 3, key: "lemon",      name: "Lemon",      multiplier: 5,  weight: 20 },
    { index: 4, key: "fish",       name: "Fish",       multiplier: 10, weight: 8  },
    { index: 5, key: "burger",     name: "Burger",     multiplier: 15, weight: 5  },
    { index: 6, key: "pizza",      name: "Pizza",      multiplier: 25, weight: 4  },
    { index: 7, key: "chicken",    name: "Chicken",    multiplier: 45, weight: 3  }
];

// =====================================================
// SERVER TIME
// =====================================================

function now() {
    return Date.now();
}

// =====================================================
// GET FOOD
// =====================================================

function getFoodByKey(key) {
    if (key === undefined || key === null) {
        return null;
    }

    const cleanKey = String(key).trim().toLowerCase();

    return FOODS.find(food => food.key === cleanKey) || null;
}

// =====================================================
// NORMALIZE FOOD
// =====================================================

function normalizeFoodInput(body) {
    if (!body) return "";

    let input = "";

    if (body.food !== undefined && body.food !== null && String(body.food).trim() !== "") {
        input = body.food;
    } else if (body.foodKey !== undefined && body.foodKey !== null && String(body.foodKey).trim() !== "") {
        input = body.foodKey;
    } else if (body.foodName !== undefined && body.foodName !== null && String(body.foodName).trim() !== "") {
        input = body.foodName;
    }

    if (!input) return "";

    const value = String(input).trim().toLowerCase();

    const nameMap = {
        apple: "apple",
        mango: "mango",
        strawberry: "strawberry",
        lemon: "lemon",
        fish: "fish",
        burger: "burger",
        pizza: "pizza",
        chicken: "chicken"
    };

    return nameMap[value] || value;
}

// =====================================================
// WEIGHTED WINNER
// =====================================================

function chooseWeightedFood() {
    let totalWeight = 0;

    for (const food of FOODS) {
        totalWeight += Number(food.weight);
    }

    let roll = Math.random() * totalWeight;

    for (const food of FOODS) {
        roll -= Number(food.weight);

        if (roll <= 0) {
            return food;
        }
    }

    return FOODS[0];
}

// =====================================================
// VERIFY FIREBASE USER
// =====================================================

async function verifyUser(req) {
    const authorization = req.headers.authorization;

    if (!authorization) {
        throw new Error("Authorization token missing");
    }

    if (!authorization.startsWith("Bearer ")) {
        throw new Error("Invalid authorization header");
    }

    const token = authorization.substring(7);

    if (!token) {
        throw new Error("Authorization token missing");
    }

    return await admin.auth().verifyIdToken(token);
}

// =====================================================
// PER USER LOCK
// =====================================================

const userLocks = new Map();

async function withUserLock(uid, work) {
    while (userLocks.has(uid)) {
        try {
            await userLocks.get(uid);
        } catch (e) {
            // ignore
        }
    }

    let release;

    const lockPromise = new Promise(resolve => {
        release = resolve;
    });

    userLocks.set(uid, lockPromise);

    try {
        return await work();
    } finally {
        userLocks.delete(uid);
        release();
    }
}

// =====================================================
// CREATE NEW ROUND
// =====================================================

async function createNewRound() {
    const currentRef = db.ref("food_game_global/current");

    const result = await currentRef.transaction(current => {
        const currentTime = now();

        if (
            current &&
            current.roundId &&
            Number(current.endAt) > currentTime
        ) {
            return current;
        }

        const roundId = String(currentTime);
        const startAt = currentTime + 1000;
        const betEndAt = startAt + BET_DURATION;
        const spinEndAt = betEndAt + SPIN_DURATION;
        const endAt = spinEndAt + SHOW_DURATION;

        return {
            roundId: roundId,
            startAt: startAt,
            betEndAt: betEndAt,
            spinEndAt: spinEndAt,
            endAt: endAt,
            phase: "betting",
            winnerIndex: -1,
            winnerKey: "",
            winnerName: "",
            winnerMultiplier: 0,
            createdAt: admin.database.ServerValue.TIMESTAMP
        };
    });

    if (!result.committed) {
        throw new Error("Unable to create round");
    }

    const round = result.snapshot.val();

    if (round && round.roundId) {
        const roundRef = db.ref(
            `food_game_global/rounds/${round.roundId}`
        );

        const snapshot = await roundRef.once("value");

        if (!snapshot.exists()) {
            await roundRef.set({
                roundId: round.roundId,
                startAt: Number(round.startAt),
                betEndAt: Number(round.betEndAt),
                spinEndAt: Number(round.spinEndAt),
                endAt: Number(round.endAt),
                phase: "betting",
                winnerIndex: -1,
                winnerKey: "",
                winnerName: "",
                winnerMultiplier: 0,
                createdAt: admin.database.ServerValue.TIMESTAMP
            });
        }
    }

    return round;
}

// =====================================================
// GET CURRENT ROUND
// =====================================================

async function getCurrentRound() {
    const ref = db.ref("food_game_global/current");
    const snapshot = await ref.once("value");
    const round = snapshot.val();

    if (!round || !round.roundId) {
        return await createNewRound();
    }

    if (Number(round.endAt) <= now()) {
        return await createNewRound();
    }

    return round;
}

// =====================================================
// CHOOSE WINNER
// =====================================================

async function chooseWinner(roundId) {
    const currentRef = db.ref("food_game_global/current");
    const randomWinner = chooseWeightedFood();

    const result = await currentRef.transaction(current => {
        if (!current) return;

        if (current.roundId !== roundId) {
            return current;
        }

        if (Number(current.winnerIndex) >= 0) {
            return current;
        }

        current.winnerIndex = randomWinner.index;
        current.winnerKey = randomWinner.key;
        current.winnerName = randomWinner.name;
        current.winnerMultiplier = randomWinner.multiplier;
        current.phase = "spin";

        return current;
    });

    if (!result.committed) {
        return null;
    }

    const finalRound = result.snapshot.val();

    if (finalRound && finalRound.roundId) {
        await db.ref(
            `food_game_global/rounds/${roundId}`
        ).update({
            winnerIndex: Number(finalRound.winnerIndex),
            winnerKey: finalRound.winnerKey,
            winnerName: finalRound.winnerName,
            winnerMultiplier: Number(finalRound.winnerMultiplier),
            phase: "spin"
        });
    }

    console.log("=================================");
    console.log("WINNER SELECTED");
    console.log("ROUND:", roundId);
    console.log("FOOD:", randomWinner.name);
    console.log("KEY:", randomWinner.key);
    console.log("MULTIPLIER:", randomWinner.multiplier);
    console.log("=================================");

    return randomWinner;
}

// =====================================================
// UPDATE ROUND PHASE
// =====================================================

async function updateRoundPhase(round) {
    if (!round) return;

    const currentTime = now();
    let phase;

    if (currentTime < Number(round.betEndAt)) {
        phase = "betting";
    } else if (currentTime < Number(round.spinEndAt)) {
        phase = "spin";
    } else if (currentTime < Number(round.endAt)) {
        phase = "result";
    } else {
        return;
    }

    if (phase !== round.phase) {
        await db.ref("food_game_global/current").update({
            phase: phase
        });

        await db.ref(
            `food_game_global/rounds/${round.roundId}`
        ).update({
            phase: phase
        });
    }
}

// =====================================================
// SAVE RESULT HISTORY
// =====================================================

async function saveResultHistory(round) {
    if (!round || !round.roundId || !round.winnerKey) {
        return;
    }

    const winner = getFoodByKey(round.winnerKey);

    if (!winner) return;

    const ref = db.ref(
        `food_game_global/result_history/${round.roundId}`
    );

    const snapshot = await ref.once("value");

    if (snapshot.exists()) return;

    await ref.set({
        roundId: round.roundId,
        food: winner.key,
        foodName: winner.name,
        multiplier: winner.multiplier,
        createdAt: admin.database.ServerValue.TIMESTAMP
    });
}

// =====================================================
// GAME STATE
// =====================================================

app.get("/game/state", async (req, res) => {
    try {
        let round = await getCurrentRound();
        let currentTime = now();

        if (
            currentTime >= Number(round.betEndAt) &&
            Number(round.winnerIndex) < 0
        ) {
            await chooseWinner(round.roundId);
            round = await getCurrentRound();
        }

        await updateRoundPhase(round);

        round = await getCurrentRound();
        currentTime = now();

        if (
            Number(round.winnerIndex) >= 0 &&
            currentTime >= Number(round.spinEndAt)
        ) {
            await saveResultHistory(round);
        }

        return res.json({
            success: true,
            roundId: String(round.roundId),
            startAt: Number(round.startAt),
            betEndAt: Number(round.betEndAt),
            spinEndAt: Number(round.spinEndAt),
            endAt: Number(round.endAt),
            phase: round.phase,
            winnerIndex: Number(round.winnerIndex),
            winnerKey: round.winnerKey || "",
            winnerName: round.winnerName || "",
            winnerMultiplier: Number(round.winnerMultiplier || 0),
            serverTime: currentTime
        });

    } catch (error) {
        console.error("STATE ERROR:", error);

        return res.status(500).json({
            success: false,
            error: "Unable to get game state"
        });
    }
});

// =====================================================
// PLACE BET
// IMPORTANT:
// No diamond transaction is used here.
// We use per-user lock + direct Admin write.
// =====================================================

app.post("/game/bet", async (req, res) => {
    try {
        const decoded = await verifyUser(req);
        const uid = decoded.uid;

        const amount = Number(
            req.body ? req.body.amount : 0
        );

        if (
            !Number.isFinite(amount) ||
            !Number.isInteger(amount) ||
            amount <= 0
        ) {
            return res.status(400).json({
                success: false,
                error: "Invalid bet amount",
                receivedAmount: amount
            });
        }

        const foodInput = normalizeFoodInput(req.body);
        const food = getFoodByKey(foodInput);

        if (!food) {
            return res.status(400).json({
                success: false,
                error: "Invalid food",
                received: foodInput,
                allowedFoods: FOODS.map(item => item.key)
            });
        }

        return await withUserLock(uid, async () => {

            const round = await getCurrentRound();
            const currentTime = now();

            if (currentTime < Number(round.startAt)) {
                return res.status(400).json({
                    success: false,
                    error: "Round has not started",
                    roundId: round.roundId
                });
            }

            if (currentTime >= Number(round.betEndAt)) {
                return res.status(400).json({
                    success: false,
                    error: "Betting closed",
                    roundId: round.roundId
                });
            }

            const diamondRef = db.ref(
                `users/${uid}/diamonds`
            );

            const betRef = db.ref(
                `food_game_global/rounds/${round.roundId}/bets/${uid}/${food.key}`
            );

            // =============================================
            // READ LATEST DIAMONDS
            // =============================================

            const balanceSnapshot =
                await diamondRef.once("value");

            const rawBalance =
                balanceSnapshot.val();

            const balance =
                Number(rawBalance);

            console.log("=================================");
            console.log("BET REQUEST");
            console.log("UID:", uid);
            console.log("ROUND:", round.roundId);
            console.log("FOOD:", food.key);
            console.log("BET:", amount);
            console.log("RAW DIAMONDS:", rawBalance);
            console.log("PARSED DIAMONDS:", balance);
            console.log("=================================");

            // =============================================
            // BALANCE VALIDATION
            // =============================================

            if (
                !Number.isFinite(balance) ||
                balance < 0
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid diamond balance",
                    serverDiamonds: balance,
                    rawDiamonds: rawBalance,
                    uid: uid,
                    roundId: round.roundId
                });
            }

            if (balance < amount) {
                return res.status(400).json({
                    success: false,
                    error: "Not enough diamonds",
                    serverDiamonds: balance,
                    receivedAmount: amount,
                    uid: uid,
                    roundId: round.roundId
                });
            }

            // =============================================
            // DEDUCT DIAMONDS
            // =============================================

            const newBalance =
                balance - amount;

            try {
                await diamondRef.set(newBalance);
            } catch (diamondError) {
                console.error(
                    "DIAMOND WRITE ERROR:",
                    diamondError
                );

                return res.status(500).json({
                    success: false,
                    error: "Diamond deduction failed",
                    details:
                        diamondError.message || "",
                    serverDiamonds: balance,
                    receivedAmount: amount,
                    uid: uid,
                    roundId: round.roundId
                });
            }

            // =============================================
            // VERIFY DEDUCTION
            // =============================================

            const verifySnapshot =
                await diamondRef.once("value");

            const verifiedBalance =
                Number(verifySnapshot.val());

            if (
                !Number.isFinite(verifiedBalance) ||
                verifiedBalance !== newBalance
            ) {
                console.error(
                    "DIAMOND VERIFY FAILED"
                );

                // Best-effort restore.
                try {
                    await diamondRef.set(balance);
                } catch (restoreError) {
                    console.error(
                        "RESTORE ERROR:",
                        restoreError
                    );
                }

                return res.status(500).json({
                    success: false,
                    error:
                        "Diamond balance verification failed",
                    serverDiamonds:
                        verifiedBalance,
                    expectedDiamonds:
                        newBalance,
                    uid:
                        uid,
                    roundId:
                        round.roundId
                });
            }

            console.log(
                "DIAMONDS DEDUCTED SUCCESSFULLY"
            );

            console.log("OLD:", balance);
            console.log("BET:", amount);
            console.log("NEW:", verifiedBalance);

            // =============================================
            // READ OLD BET
            // =============================================

            const oldBetSnapshot =
                await betRef.once("value");

            const oldBet =
                Number(
                    oldBetSnapshot.val() || 0
                );

            const newBet =
                oldBet + amount;

            // =============================================
            // SAVE BET
            // =============================================

            try {
                await betRef.set(newBet);
            } catch (betError) {

                console.error(
                    "BET SAVE FAILED:",
                    betError
                );

                // Refund.
                try {
                    const refundSnapshot =
                        await diamondRef.once("value");

                    const refundBalance =
                        Number(
                            refundSnapshot.val()
                        );

                    if (
                        Number.isFinite(refundBalance)
                    ) {
                        await diamondRef.set(
                            refundBalance + amount
                        );
                    }
                } catch (refundError) {
                    console.error(
                        "REFUND ERROR:",
                        refundError
                    );

                    return res.status(500).json({
                        success: false,
                        error:
                            "Bet save failed and refund failed",
                        roundId:
                            round.roundId,
                        food:
                            food.key,
                        amount:
                            amount
                    });
                }

                return res.status(500).json({
                    success: false,
                    error:
                        "Bet save failed. Diamonds refunded.",
                    roundId:
                        round.roundId,
                    food:
                        food.key,
                    amount:
                        amount
                });
            }

            // =============================================
            // POSSIBLE WIN
            // =============================================

            const possibleWin =
                amount * food.multiplier;

            const totalPossibleWin =
                newBet * food.multiplier;

            console.log("=================================");
            console.log("BET SUCCESS");
            console.log("UID:", uid);
            console.log("ROUND:", round.roundId);
            console.log("FOOD:", food.name);
            console.log("BET:", amount);
            console.log("OLD FOOD BET:", oldBet);
            console.log("TOTAL FOOD BET:", newBet);
            console.log("MULTIPLIER:", food.multiplier);
            console.log("THIS BET WIN:", possibleWin);
            console.log(
                "TOTAL POSSIBLE WIN:",
                totalPossibleWin
            );
            console.log("DIAMONDS:", verifiedBalance);
            console.log("=================================");

            return res.json({
                success: true,
                roundId: round.roundId,
                food: food.key,
                foodKey: food.key,
                foodName: food.name,
                amount: amount,
                receivedAmount: amount,
                totalFoodBet: newBet,
                multiplier: food.multiplier,
                possibleWin: possibleWin,
                totalPossibleWin: totalPossibleWin,
                diamonds: verifiedBalance
            });
        });

    } catch (error) {
        console.error("BET ERROR:", error);

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Bet failed"
        });
    }
});

// =====================================================
// SETTLE
// Winner payout = winning food total bet × multiplier
// =====================================================

app.post("/game/settle", async (req, res) => {
    try {
        const decoded = await verifyUser(req);
        const uid = decoded.uid;

        const roundId = String(
            req.body.roundId || ""
        ).trim();

        if (!roundId) {
            return res.status(400).json({
                success: false,
                error: "Round ID missing"
            });
        }

        return await withUserLock(uid, async () => {

            const roundSnapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}`
                ).once("value");

            const round =
                roundSnapshot.val();

            if (!round) {
                return res.status(404).json({
                    success: false,
                    error: "Round not found"
                });
            }

            const winner =
                getFoodByKey(round.winnerKey);

            if (
                !winner ||
                Number(round.winnerIndex) < 0
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Winner not selected"
                });
            }

            const settlementRef =
                db.ref(
                    `food_game_global/rounds/${roundId}/settlements/${uid}`
                );

            const existingSnapshot =
                await settlementRef.once("value");

            const existing =
                existingSnapshot.val();

            if (
                existing &&
                existing.status === "paid"
            ) {
                const balanceSnapshot =
                    await db.ref(
                        `users/${uid}/diamonds`
                    ).once("value");

                const oldWin =
                    Number(
                        existing.win ||
                        existing.payout ||
                        0
                    );

                return res.json({
                    success: true,
                    alreadySettled: true,
                    roundId: roundId,
                    food: winner.key,
                    foodName: winner.name,
                    bet: Number(existing.bet || 0),
                    multiplier: winner.multiplier,
                    win: oldWin,
                    payout: oldWin,
                    diamonds:
                        Number(
                            balanceSnapshot.val() || 0
                        )
                });
            }

            // =============================================
            // WINNING BET
            // =============================================

            const winningBetSnapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/bets/${uid}/${winner.key}`
                ).once("value");

            const winningBet =
                Number(
                    winningBetSnapshot.val() || 0
                );

            // =============================================
            // NO WIN
            // =============================================

            if (
                !Number.isFinite(winningBet) ||
                winningBet <= 0
            ) {

                await settlementRef.set({
                    status: "paid",
                    uid: uid,
                    roundId: roundId,
                    food: winner.key,
                    bet: 0,
                    multiplier: winner.multiplier,
                    win: 0,
                    payout: 0,
                    paidAt:
                        admin.database
                            .ServerValue
                            .TIMESTAMP
                });

                const balanceSnapshot =
                    await db.ref(
                        `users/${uid}/diamonds`
                    ).once("value");

                return res.json({
                    success: true,
                    alreadySettled: false,
                    roundId: roundId,
                    food: winner.key,
                    foodName: winner.name,
                    bet: 0,
                    multiplier: winner.multiplier,
                    win: 0,
                    payout: 0,
                    diamonds:
                        Number(
                            balanceSnapshot.val() || 0
                        )
                });
            }

            // =============================================
            // PAYOUT
            // =============================================

            const payout =
                winningBet * winner.multiplier;

            console.log("=================================");
            console.log("SETTLEMENT");
            console.log("UID:", uid);
            console.log("ROUND:", roundId);
            console.log("WINNER:", winner.name);
            console.log("WINNING BET:", winningBet);
            console.log("MULTIPLIER:", winner.multiplier);
            console.log("PAYOUT:", payout);
            console.log("=================================");

            const diamondRef =
                db.ref(
                    `users/${uid}/diamonds`
                );

            // =============================================
            // READ CURRENT BALANCE
            // =============================================

            const balanceSnapshot =
                await diamondRef.once("value");

            const currentBalance =
                Number(
                    balanceSnapshot.val() || 0
                );

            if (
                !Number.isFinite(currentBalance) ||
                currentBalance < 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid diamond balance before payout",
                    serverDiamonds:
                        currentBalance,
                    roundId:
                        roundId
                });
            }

            // =============================================
            // ADD WINNER DIAMONDS
            // =============================================

            const newBalance =
                currentBalance + payout;

            try {
                await diamondRef.set(
                    newBalance
                );
            } catch (payoutError) {
                console.error(
                    "PAYOUT WRITE ERROR:",
                    payoutError
                );

                return res.status(500).json({
                    success: false,
                    error:
                        "Winner diamond payout failed",
                    details:
                        payoutError.message || "",
                    roundId:
                        roundId,
                    payout:
                        payout
                });
            }

            // =============================================
            // VERIFY PAYOUT
            // =============================================

            const payoutVerifySnapshot =
                await diamondRef.once("value");

            const verifiedBalance =
                Number(
                    payoutVerifySnapshot.val()
                );

            if (
                !Number.isFinite(verifiedBalance) ||
                verifiedBalance !== newBalance
            ) {
                return res.status(500).json({
                    success: false,
                    error:
                        "Winner diamond payout verification failed",
                    serverDiamonds:
                        verifiedBalance,
                    expectedDiamonds:
                        newBalance,
                    roundId:
                        roundId,
                    payout:
                        payout
                });
            }

            // =============================================
            // INDIA DATE
            // =============================================

            const indiaDate =
                new Intl.DateTimeFormat(
                    "en-CA",
                    {
                        timeZone: "Asia/Kolkata",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit"
                    }
                ).format(new Date());

            // =============================================
            // TODAY WIN
            // =============================================

            const todayRef =
                db.ref(
                    `users/${uid}/food_game_today`
                );

            await todayRef.transaction(current => {
                current = current || {};

                const savedDate =
                    String(current.date || "");

                let oldWin =
                    Number(current.win || 0);

                if (savedDate !== indiaDate) {
                    oldWin = 0;
                }

                current.date = indiaDate;
                current.win = oldWin + payout;

                return current;
            });

            // =============================================
            // USER PROFILE
            // =============================================

            const userSnapshot =
                await db.ref(
                    `users/${uid}`
                ).once("value");

            const user =
                userSnapshot.val() || {};

            const userName =
                user.name ||
                user.user_name ||
                user.username ||
                user.displayName ||
                "User";

            const profileImage =
                user.profile_pic ||
                user.profile_image ||
                user.profileImage ||
                user.profileURL ||
                user.profileUrl ||
                "";

            // =============================================
            // RESULT
            // =============================================

            const resultPath =
                `food_game_global/rounds/${roundId}/results/${uid}`;

            await db.ref(resultPath).set({
                uid: uid,
                name: userName,
                profile_image: profileImage,
                food: winner.name,
                foodKey: winner.key,
                bet: winningBet,
                multiplier: winner.multiplier,
                win: payout,
                round: roundId,
                time:
                    admin.database
                        .ServerValue
                        .TIMESTAMP
            });

            // =============================================
            // SETTLEMENT PAID
            // =============================================

            await settlementRef.set({
                status: "paid",
                uid: uid,
                roundId: roundId,
                food: winner.key,
                bet: winningBet,
                multiplier: winner.multiplier,
                win: payout,
                payout: payout,
                paidAt:
                    admin.database
                        .ServerValue
                        .TIMESTAMP
            });

            // =============================================
            // LEADERBOARD
            // =============================================

            const leaderboardRef =
                db.ref(
                    `food_game_global/leaderboard/${uid}`
                );

            await leaderboardRef.transaction(current => {
                current = current || {};

                const oldTotal =
                    Number(current.total_win || 0);

                current.uid = uid;
                current.name = userName;
                current.profile_image = profileImage;
                current.total_win =
                    oldTotal + payout;
                current.last_win = payout;
                current.last_food = winner.name;
                current.last_round = roundId;
                current.updated_at =
                    admin.database
                        .ServerValue
                        .TIMESTAMP;

                return current;
            });

            console.log("=================================");
            console.log("PAYOUT SUCCESS");
            console.log("UID:", uid);
            console.log("ROUND:", roundId);
            console.log("WINNER:", winner.name);
            console.log("BET:", winningBet);
            console.log("MULTIPLIER:", winner.multiplier);
            console.log("PAYOUT:", payout);
            console.log("FINAL BALANCE:", verifiedBalance);
            console.log("=================================");

            return res.json({
                success: true,
                alreadySettled: false,
                roundId: roundId,
                food: winner.key,
                foodName: winner.name,
                bet: winningBet,
                multiplier: winner.multiplier,
                win: payout,
                payout: payout,
                diamonds: verifiedBalance
            });
        });

    } catch (error) {
        console.error("SETTLE ERROR:", error);

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Settlement failed"
        });
    }
});

// =====================================================
// TOP 3
// =====================================================

app.get("/game/top3/:roundId", async (req, res) => {
    try {
        const roundId =
            String(req.params.roundId || "").trim();

        if (!roundId) {
            return res.status(400).json({
                success: false,
                error: "Round ID missing"
            });
        }

        const snapshot =
            await db.ref(
                `food_game_global/rounds/${roundId}/results`
            ).once("value");

        const results =
            snapshot.val() || {};

        const top3 =
            Object.keys(results)
                .map(uid => ({
                    uid: uid,
                    ...results[uid]
                }))
                .filter(
                    item =>
                        Number(item.win || 0) > 0
                )
                .sort(
                    (a, b) =>
                        Number(b.win || 0) -
                        Number(a.win || 0)
                )
                .slice(0, 3);

        return res.json({
            success: true,
            roundId: roundId,
            top3: top3
        });

    } catch (error) {
        console.error("TOP3 ERROR:", error);

        return res.status(500).json({
            success: false,
            error: "Unable to get top3"
        });
    }
});

// =====================================================
// RESULTS
// =====================================================

app.get("/game/results/:roundId", async (req, res) => {
    try {
        const roundId =
            String(req.params.roundId || "").trim();

        if (!roundId) {
            return res.status(400).json({
                success: false,
                error: "Round ID missing"
            });
        }

        const snapshot =
            await db.ref(
                `food_game_global/rounds/${roundId}/results`
            ).once("value");

        return res.json({
            success: true,
            roundId: roundId,
            results:
                snapshot.val() || {}
        });

    } catch (error) {
        console.error("RESULTS ERROR:", error);

        return res.status(500).json({
            success: false,
            error: "Unable to get results"
        });
    }
});

// =====================================================
// HISTORY
// =====================================================

app.get("/game/history", async (req, res) => {
    try {
        const snapshot =
            await db.ref(
                "food_game_global/result_history"
            )
            .orderByChild("createdAt")
            .once("value");

        const data =
            snapshot.val() || {};

        const history =
            Object.keys(data)
                .map(key => ({
                    id: key,
                    ...data[key]
                }))
                .sort(
                    (a, b) =>
                        Number(b.createdAt || 0) -
                        Number(a.createdAt || 0)
                )
                .slice(0, 8);

        return res.json({
            success: true,
            history: history
        });

    } catch (error) {
        console.error("HISTORY ERROR:", error);

        return res.status(500).json({
            success: false,
            error: "Unable to get history"
        });
    }
});

// =====================================================
// CONFIG
// =====================================================

app.get("/game/config", (req, res) => {
    return res.json({
        success: true,
        betDuration: BET_DURATION,
        spinDuration: SPIN_DURATION,
        showDuration: SHOW_DURATION,
        foods: FOODS.map(food => ({
            index: food.index,
            key: food.key,
            name: food.name,
            multiplier: food.multiplier,
            weight: food.weight
        }))
    });
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
    return res.json({
        success: true,
        server: "VibeCash Food Game Server",
        status: "online",
        firebaseProject: serviceAccount.project_id,
        time: now()
    });
});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {
    return res.status(404).json({
        success: false,
        error: "Endpoint not found",
        path: req.path
    });
});

// =====================================================
// EXPRESS ERROR
// =====================================================

app.use((error, req, res, next) => {
    console.error("EXPRESS ERROR:", error);

    return res.status(500).json({
        success: false,
        error: "Internal server error"
    });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
    console.log("=================================");
    console.log("VIBECASH FOOD GAME SERVER ONLINE");
    console.log("PORT:", PORT);
    console.log("BET:", BET_DURATION / 1000, "seconds");
    console.log("SPIN:", SPIN_DURATION / 1000, "seconds");
    console.log("RESULT:", SHOW_DURATION / 1000, "seconds");
    console.log("FOODS:", FOODS.length);
    console.log("FIREBASE PROJECT:", serviceAccount.project_id);
    console.log("DATABASE:", FIREBASE_DATABASE_URL);
    console.log("=================================");
});
