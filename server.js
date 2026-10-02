// =====================================================
// VIBECASH FOOD GAME SERVER
// RENDER + NODE.JS + EXPRESS + FIREBASE ADMIN
// SERVER AUTHORITATIVE VERSION
// =====================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// =====================================================
// ENVIRONMENT
// =====================================================

const PORT = Number(process.env.PORT || 10000);
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

const TOTAL_ROUND_DURATION =
    1000 + BET_DURATION + SPIN_DURATION + SHOW_DURATION;

// =====================================================
// FOOD CONFIG
// =====================================================

const FOODS = [
    { index: 0, key: "apple",      name: "Apple",      multiplier: 5,  weight: 20 },
    { index: 1, key: "mango",      name: "Mango",      multiplier: 5,  weight: 20 },
    { index: 2, key: "strawberry", name: "Strawberry", multiplier: 5,  weight: 20 },
    { index: 3, key: "lemon",      name: "Lemon",      multiplier: 5,  weight: 20 },
    { index: 4, key: "fish",       name: "Fish",       multiplier: 10, weight: 8 },
    { index: 5, key: "burger",     name: "Burger",     multiplier: 15, weight: 5 },
    { index: 6, key: "pizza",      name: "Pizza",      multiplier: 25, weight: 4 },
    { index: 7, key: "chicken",    name: "Chicken",    multiplier: 45, weight: 3 }
];

// =====================================================
// BASIC HELPERS
// =====================================================

function now() {
    return Date.now();
}

function cleanString(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value).trim();
}

function toSafeNumber(value, fallback = 0) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return number;
}

function getFoodByKey(key) {
    const cleanKey = cleanString(key).toLowerCase();

    if (!cleanKey) {
        return null;
    }

    return FOODS.find(food => food.key === cleanKey) || null;
}

// =====================================================
// NORMALIZE FOOD INPUT
// =====================================================

function normalizeFoodInput(body) {
    if (!body) {
        return "";
    }

    let input = "";

    if (
        body.food !== undefined &&
        body.food !== null &&
        cleanString(body.food) !== ""
    ) {
        input = body.food;
    } else if (
        body.foodKey !== undefined &&
        body.foodKey !== null &&
        cleanString(body.foodKey) !== ""
    ) {
        input = body.foodKey;
    } else if (
        body.foodName !== undefined &&
        body.foodName !== null &&
        cleanString(body.foodName) !== ""
    ) {
        input = body.foodName;
    }

    const value = cleanString(input).toLowerCase();

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
// CRYPTO WEIGHTED WINNER
//
// Weight total = 100.
// 0-19    Apple
// 20-39   Mango
// 40-59   Strawberry
// 60-79   Lemon
// 80-87   Fish
// 88-92   Burger
// 93-96   Pizza
// 97-99   Chicken
//
// IMPORTANT:
// This function is called ONCE when a new round is created.
// /game/state NEVER generates a new winner.
// =====================================================

function chooseWeightedFood() {
    let totalWeight = 0;

    for (const food of FOODS) {
        const weight = Math.max(
            0,
            Math.floor(toSafeNumber(food.weight, 0))
        );

        totalWeight += weight;
    }

    if (totalWeight <= 0) {
        throw new Error("Food weights are invalid");
    }

    const roll = crypto.randomInt(0, totalWeight);

    let cursor = 0;

    for (const food of FOODS) {
        const weight = Math.max(
            0,
            Math.floor(toSafeNumber(food.weight, 0))
        );

        cursor += weight;

        if (roll < cursor) {
            return food;
        }
    }

    return FOODS[FOODS.length - 1];
}

// =====================================================
// FIREBASE AUTH
// =====================================================

async function verifyUser(req) {
    const authorization =
        req.headers.authorization;

    if (!authorization) {
        throw new Error(
            "Authorization token missing"
        );
    }

    if (!authorization.startsWith("Bearer ")) {
        throw new Error(
            "Invalid authorization header"
        );
    }

    const token =
        authorization.substring(7).trim();

    if (!token) {
        throw new Error(
            "Authorization token missing"
        );
    }

    return await admin.auth().verifyIdToken(token);
}

// =====================================================
// PER USER LOCK
// =====================================================

const userLocks = new Map();

async function withUserLock(uid, work) {
    const previous =
        userLocks.get(uid) || Promise.resolve();

    let release;

    const current =
        new Promise(resolve => {
            release = resolve;
        });

    userLocks.set(uid, current);

    try {
        await previous;
        return await work();
    } finally {
        if (userLocks.get(uid) === current) {
            userLocks.delete(uid);
        }

        release();
    }
}

// =====================================================
// ROUND OBJECT
// =====================================================

function buildRound(roundId, startAt, winner) {
    const betEndAt =
        startAt + BET_DURATION;

    const spinEndAt =
        betEndAt + SPIN_DURATION;

    const showEndAt =
        spinEndAt + SHOW_DURATION;

    return {
        roundId: roundId,

        startAt: startAt,
        betEndAt: betEndAt,
        spinEndAt: spinEndAt,
        showEndAt: showEndAt,
        endAt: showEndAt,

        phase: "betting",

        // WINNER IS FIXED FOR THIS ROUND.
        winnerIndex: winner.index,
        winnerKey: winner.key,
        winnerName: winner.name,
        winnerMultiplier: winner.multiplier,

        createdAt:
            admin.database.ServerValue.TIMESTAMP
    };
}

// =====================================================
// CREATE NEW ROUND
//
// Firebase transaction guarantees that only one current
// round wins when multiple clients call /game/state.
// Winner is generated BEFORE the transaction and is saved
// with the new round. It is NOT regenerated on every poll.
// =====================================================

async function createNewRound() {
    const currentRef =
        db.ref("food_game_global/current");

    const generatedWinner =
        chooseWeightedFood();

    const result =
        await currentRef.transaction(current => {
            const currentTime = now();

            if (
                current &&
                current.roundId &&
                Number(current.endAt) > currentTime
            ) {
                return current;
            }

            const roundId =
                String(currentTime);

            const startAt =
                currentTime + 1000;

            return buildRound(
                roundId,
                startAt,
                generatedWinner
            );
        });

    if (!result.committed) {
        throw new Error(
            "Unable to create food game round"
        );
    }

    const round =
        result.snapshot.val();

    if (!round || !round.roundId) {
        throw new Error(
            "Created round is invalid"
        );
    }

    const roundRef =
        db.ref(
            `food_game_global/rounds/${round.roundId}`
        );

    const existing =
        await roundRef.once("value");

    if (!existing.exists()) {
        await roundRef.set({
            roundId: round.roundId,

            startAt:
                Number(round.startAt),

            betEndAt:
                Number(round.betEndAt),

            spinEndAt:
                Number(round.spinEndAt),

            showEndAt:
                Number(round.showEndAt),

            endAt:
                Number(round.endAt),

            phase:
                "betting",

            winnerIndex:
                Number(round.winnerIndex),

            winnerKey:
                round.winnerKey,

            winnerName:
                round.winnerName,

            winnerMultiplier:
                Number(round.winnerMultiplier),

            createdAt:
                admin.database.ServerValue.TIMESTAMP
        });
    }

    console.log("=================================");
    console.log("NEW ROUND");
    console.log("ROUND:", round.roundId);
    console.log(
        "WINNER:",
        round.winnerName
    );
    console.log(
        "WINNER INDEX:",
        round.winnerIndex
    );
    console.log(
        "MULTIPLIER:",
        round.winnerMultiplier
    );
    console.log("=================================");

    return round;
}

// =====================================================
// GET CURRENT ROUND
// =====================================================

async function getCurrentRound() {
    const ref =
        db.ref(
            "food_game_global/current"
        );

    const snapshot =
        await ref.once("value");

    const round =
        snapshot.val();

    if (
        !round ||
        !round.roundId
    ) {
        return await createNewRound();
    }

    if (
        Number(round.endAt) <= now()
    ) {
        return await createNewRound();
    }

    // Safety repair for old/incomplete rounds.
    if (
        Number(round.winnerIndex) < 0 ||
        !round.winnerKey
    ) {
        console.error(
            "WARNING: current round has no winner:",
            round.roundId
        );

        // Old broken round is allowed to finish,
        // but a winner must be selected before betting closes.
    }

    return round;
}

// =====================================================
// FINALIZE OLD/LEGACY ROUND WINNER
//
// This exists only for compatibility with a round created
// by an older server version where winnerIndex = -1.
//
// New rounds already have a winner.
// =====================================================

async function ensureWinnerForRound(round) {
    if (!round || !round.roundId) {
        return round;
    }

    if (
        Number(round.winnerIndex) >= 0 &&
        round.winnerKey
    ) {
        return round;
    }

    const currentRef =
        db.ref(
            "food_game_global/current"
        );

    const winner =
        chooseWeightedFood();

    const transaction =
        await currentRef.transaction(current => {
            if (!current) {
                return;
            }

            if (
                current.roundId !==
                round.roundId
            ) {
                return current;
            }

            if (
                Number(current.winnerIndex) >= 0 &&
                current.winnerKey
            ) {
                return current;
            }

            current.winnerIndex =
                winner.index;

            current.winnerKey =
                winner.key;

            current.winnerName =
                winner.name;

            current.winnerMultiplier =
                winner.multiplier;

            return current;
        });

    if (!transaction.committed) {
        return await getCurrentRound();
    }

    const finalRound =
        transaction.snapshot.val();

    if (
        finalRound &&
        finalRound.roundId === round.roundId
    ) {
        await db.ref(
            `food_game_global/rounds/${round.roundId}`
        ).update({
            winnerIndex:
                Number(finalRound.winnerIndex),

            winnerKey:
                finalRound.winnerKey,

            winnerName:
                finalRound.winnerName,

            winnerMultiplier:
                Number(
                    finalRound.winnerMultiplier
                )
        });

        console.log(
            "LEGACY ROUND WINNER SELECTED:",
            finalRound.roundId,
            finalRound.winnerName
        );

        return finalRound;
    }

    return await getCurrentRound();
}

// =====================================================
// UPDATE PHASE
// =====================================================

async function updateRoundPhase(round) {
    if (!round) {
        return;
    }

    const currentTime =
        now();

    let phase;

    if (
        currentTime <
        Number(round.startAt)
    ) {
        phase = "waiting";
    } else if (
        currentTime <
        Number(round.betEndAt)
    ) {
        phase = "betting";
    } else if (
        currentTime <
        Number(round.spinEndAt)
    ) {
        phase = "spin";
    } else if (
        currentTime <
        Number(round.showEndAt)
    ) {
        phase = "result";
    } else {
        return;
    }

    if (phase !== round.phase) {
        await db.ref(
            "food_game_global/current"
        ).update({
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
    if (
        !round ||
        !round.roundId ||
        Number(round.winnerIndex) < 0
    ) {
        return;
    }

    const winner =
        getFoodByKey(round.winnerKey);

    if (!winner) {
        return;
    }

    const ref =
        db.ref(
            `food_game_global/result_history/${round.roundId}`
        );

    const snapshot =
        await ref.once("value");

    if (snapshot.exists()) {
        return;
    }

    await ref.set({
        roundId:
            round.roundId,

        winnerIndex:
            winner.index,

        food:
            winner.key,

        foodName:
            winner.name,

        multiplier:
            winner.multiplier,

        createdAt:
            admin.database.ServerValue.TIMESTAMP
    });
}

// =====================================================
// GAME STATE
//
// IMPORTANT:
// This endpoint DOES NOT choose a new winner.
// It only returns the winner already saved in Firebase.
// =====================================================

app.get("/game/state", async (req, res) => {
    try {
        let round =
            await getCurrentRound();

        const currentTime =
            now();

        // Only legacy rounds without a winner
        // can reach this code.
        if (
            Number(round.winnerIndex) < 0 &&
            currentTime >=
                Number(round.betEndAt)
        ) {
            round =
                await ensureWinnerForRound(round);
        }

        await updateRoundPhase(round);

        round =
            await getCurrentRound();

        const time =
            now();

        if (
            Number(round.winnerIndex) >= 0 &&
            time >=
                Number(round.spinEndAt)
        ) {
            await saveResultHistory(round);
        }

        // Do NOT reveal the winner during betting.
        // The winner is already fixed in Firebase, but
        // clients only receive it when betting has ended.
        const bettingFinished =
            time >= Number(round.betEndAt);

        const visibleWinnerIndex =
            bettingFinished
                ? Number(round.winnerIndex)
                : -1;

        const visibleWinnerKey =
            bettingFinished
                ? (round.winnerKey || "")
                : "";

        const visibleWinnerName =
            bettingFinished
                ? (round.winnerName || "")
                : "";

        const visibleWinnerMultiplier =
            bettingFinished
                ? Number(round.winnerMultiplier || 0)
                : 0;

        return res.json({
            success: true,

            serverTime:
                time,

            roundId:
                String(round.roundId),

            startAt:
                Number(round.startAt),

            betEndAt:
                Number(round.betEndAt),

            spinEndAt:
                Number(round.spinEndAt),

            showEndAt:
                Number(round.showEndAt),

            endAt:
                Number(round.endAt),

            phase:
                round.phase || "betting",

            winnerIndex:
                visibleWinnerIndex,

            winnerKey:
                visibleWinnerKey,

            winnerName:
                visibleWinnerName,

            winnerMultiplier:
                visibleWinnerMultiplier
        });

    } catch (error) {
        console.error(
            "STATE ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Unable to get game state"
        });
    }
});

// =====================================================
// PLACE BET
// =====================================================

app.post("/game/bet", async (req, res) => {
    try {
        const decoded =
            await verifyUser(req);

        const uid =
            decoded.uid;

        const amount =
            Number(
                req.body
                    ? req.body.amount
                    : 0
            );

        if (
            !Number.isInteger(amount) ||
            amount <= 0
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid bet amount"
            });
        }

        const foodInput =
            normalizeFoodInput(req.body);

        const food =
            getFoodByKey(foodInput);

        if (!food) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid food",
                received:
                    foodInput,
                allowedFoods:
                    FOODS.map(
                        item => item.key
                    )
            });
        }

        return await withUserLock(
            uid,
            async () => {

                const round =
                    await getCurrentRound();

                const currentTime =
                    now();

                if (
                    currentTime <
                    Number(round.startAt)
                ) {
                    return res.status(400).json({
                        success: false,
                        error:
                            "Round has not started",
                        roundId:
                            round.roundId
                    });
                }

                if (
                    currentTime >=
                    Number(round.betEndAt)
                ) {
                    return res.status(400).json({
                        success: false,
                        error:
                            "Betting closed",
                        roundId:
                            round.roundId
                    });
                }

                const diamondRef =
                    db.ref(
                        `users/${uid}/diamonds`
                    );

                const betRef =
                    db.ref(
                        `food_game_global/rounds/${round.roundId}/bets/${uid}/${food.key}`
                    );

                const balanceSnapshot =
                    await diamondRef.once(
                        "value"
                    );

                const rawBalance =
                    balanceSnapshot.val();

                const balance =
                    Number(rawBalance);

                console.log("=================================");
                console.log("BET");
                console.log("UID:", uid);
                console.log("ROUND:", round.roundId);
                console.log("FOOD:", food.key);
                console.log("AMOUNT:", amount);
                console.log("BALANCE:", balance);
                console.log("=================================");

                if (
                    !Number.isFinite(balance) ||
                    balance < 0
                ) {
                    return res.status(400).json({
                        success: false,
                        error:
                            "Invalid diamond balance",
                        serverDiamonds:
                            balance
                    });
                }

                if (
                    balance < amount
                ) {
                    return res.status(400).json({
                        success: false,
                        error:
                            "Not enough diamonds",
                        serverDiamonds:
                            balance,
                        receivedAmount:
                            amount
                    });
                }

                const newBalance =
                    balance - amount;

                // Deduct.
                await diamondRef.set(
                    newBalance
                );

                // Read old bet.
                const oldBetSnapshot =
                    await betRef.once(
                        "value"
                    );

                const oldBet =
                    Number(
                        oldBetSnapshot.val() || 0
                    );

                const newBet =
                    oldBet + amount;

                try {
                    await betRef.set(
                        newBet
                    );
                } catch (betError) {

                    console.error(
                        "BET SAVE ERROR:",
                        betError
                    );

                    // Refund the same user.
                    const latest =
                        await diamondRef.once(
                            "value"
                        );

                    const latestBalance =
                        Number(
                            latest.val() || 0
                        );

                    await diamondRef.set(
                        latestBalance + amount
                    );

                    return res.status(500).json({
                        success: false,
                        error:
                            "Bet save failed. Diamonds refunded."
                    });
                }

                const possibleWin =
                    amount *
                    food.multiplier;

                const totalPossibleWin =
                    newBet *
                    food.multiplier;

                return res.json({
                    success: true,

                    uid:
                        uid,

                    roundId:
                        round.roundId,

                    food:
                        food.key,

                    foodKey:
                        food.key,

                    foodName:
                        food.name,

                    amount:
                        amount,

                    receivedAmount:
                        amount,

                    totalFoodBet:
                        newBet,

                    multiplier:
                        food.multiplier,

                    possibleWin:
                        possibleWin,

                    totalPossibleWin:
                        totalPossibleWin,

                    diamonds:
                        newBalance,

                    serverDiamonds:
                        newBalance
                });
            }
        );

    } catch (error) {
        console.error(
            "BET ERROR:",
            error
        );

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
// =====================================================

app.post("/game/settle", async (req, res) => {
    try {
        const decoded =
            await verifyUser(req);

        const uid =
            decoded.uid;

        const roundId =
            cleanString(
                req.body &&
                req.body.roundId
            );

        if (!roundId) {
            return res.status(400).json({
                success: false,
                error:
                    "Round ID missing"
            });
        }

        return await withUserLock(
            uid,
            async () => {

                const roundSnapshot =
                    await db.ref(
                        `food_game_global/rounds/${roundId}`
                    ).once("value");

                const round =
                    roundSnapshot.val();

                if (!round) {
                    return res.status(404).json({
                        success: false,
                        error:
                            "Round not found"
                    });
                }

                const winner =
                    getFoodByKey(
                        round.winnerKey
                    );

                if (
                    !winner ||
                    Number(round.winnerIndex) < 0
                ) {
                    return res.status(400).json({
                        success: false,
                        error:
                            "Winner not selected"
                    });
                }

                const settlementRef =
                    db.ref(
                        `food_game_global/rounds/${roundId}/settlements/${uid}`
                    );

                const existingSnapshot =
                    await settlementRef.once(
                        "value"
                    );

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

                    const payout =
                        Number(
                            existing.payout ||
                            existing.win ||
                            0
                        );

                    return res.json({
                        success: true,
                        alreadySettled: true,
                        roundId:
                            roundId,
                        food:
                            winner.key,
                        foodName:
                            winner.name,
                        bet:
                            Number(
                                existing.bet || 0
                            ),
                        multiplier:
                            winner.multiplier,
                        win:
                            payout,
                        payout:
                            payout,
                        diamonds:
                            Number(
                                balanceSnapshot.val()
                                || 0
                            )
                    });
                }

                const winningBetSnapshot =
                    await db.ref(
                        `food_game_global/rounds/${roundId}/bets/${uid}/${winner.key}`
                    ).once("value");

                const winningBet =
                    Number(
                        winningBetSnapshot.val()
                        || 0
                    );

                // =========================================
                // NO WIN
                // =========================================

                if (
                    !Number.isFinite(winningBet) ||
                    winningBet <= 0
                ) {
                    await settlementRef.set({
                        status:
                            "paid",

                        uid:
                            uid,

                        roundId:
                            roundId,

                        food:
                            winner.key,

                        bet:
                            0,

                        multiplier:
                            winner.multiplier,

                        win:
                            0,

                        payout:
                            0,

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
                        roundId:
                            roundId,
                        food:
                            winner.key,
                        foodName:
                            winner.name,
                        bet:
                            0,
                        multiplier:
                            winner.multiplier,
                        win:
                            0,
                        payout:
                            0,
                        diamonds:
                            Number(
                                balanceSnapshot.val()
                                || 0
                            )
                    });
                }

                const payout =
                    winningBet *
                    winner.multiplier;

                const diamondRef =
                    db.ref(
                        `users/${uid}/diamonds`
                    );

                const balanceSnapshot =
                    await diamondRef.once(
                        "value"
                    );

                const currentBalance =
                    Number(
                        balanceSnapshot.val()
                        || 0
                    );

                if (
                    !Number.isFinite(
                        currentBalance
                    ) ||
                    currentBalance < 0
                ) {
                    return res.status(400).json({
                        success: false,
                        error:
                            "Invalid diamond balance"
                    });
                }

                const newBalance =
                    currentBalance + payout;

                // =========================================
                // WRITE PAYOUT
                // =========================================

                await diamondRef.set(
                    newBalance
                );

                // =========================================
                // READ PROFILE
                // =========================================

                const userSnapshot =
                    await db.ref(
                        `users/${uid}`
                    ).once("value");

                const user =
                    userSnapshot.val()
                    || {};

                const userName =
                    cleanString(
                        user.name ||
                        user.user_name ||
                        user.username ||
                        user.displayName ||
                        "User"
                    );

                const profileImage =
                    cleanString(
                        user.profile_pic ||
                        user.profile_image ||
                        user.profileImage ||
                        user.profileURL ||
                        user.profileUrl ||
                        ""
                    );

                // =========================================
                // INDIA DATE
                // =========================================

                const indiaDate =
                    new Intl.DateTimeFormat(
                        "en-CA",
                        {
                            timeZone:
                                "Asia/Kolkata",
                            year:
                                "numeric",
                            month:
                                "2-digit",
                            day:
                                "2-digit"
                        }
                    ).format(
                        new Date()
                    );

                // =========================================
                // TODAY WIN
                // =========================================

                const todayRef =
                    db.ref(
                        `users/${uid}/food_game_today`
                    );

                let todayWinAfter =
                    payout;

                await todayRef.transaction(
                    current => {

                        current =
                            current || {};

                        const savedDate =
                            cleanString(
                                current.date
                            );

                        let oldWin =
                            Number(
                                current.win || 0
                            );

                        if (
                            savedDate !==
                            indiaDate
                        ) {
                            oldWin = 0;
                        }

                        const newTodayWin =
                            oldWin + payout;

                        todayWinAfter =
                            newTodayWin;

                        current.date =
                            indiaDate;

                        current.win =
                            newTodayWin;

                        return current;
                    }
                );

                // =========================================
                // ROUND RESULT
                // =========================================

                await db.ref(
                    `food_game_global/rounds/${roundId}/results/${uid}`
                ).set({
                    uid:
                        uid,

                    name:
                        userName,

                    profile_image:
                        profileImage,

                    food:
                        winner.name,

                    foodKey:
                        winner.key,

                    bet:
                        winningBet,

                    multiplier:
                        winner.multiplier,

                    win:
                        payout,

                    payout:
                        payout,

                    round:
                        roundId,

                    time:
                        admin.database
                            .ServerValue
                            .TIMESTAMP
                });

                // =========================================
                // SETTLEMENT
                // =========================================

                await settlementRef.set({
                    status:
                        "paid",

                    uid:
                        uid,

                    roundId:
                        roundId,

                    food:
                        winner.key,

                    bet:
                        winningBet,

                    multiplier:
                        winner.multiplier,

                    win:
                        payout,

                    payout:
                        payout,

                    todayWin:
                        todayWinAfter,

                    paidAt:
                        admin.database
                            .ServerValue
                            .TIMESTAMP
                });

                // =========================================
                // LEADERBOARD
                // =========================================

                const leaderboardRef =
                    db.ref(
                        `food_game_global/leaderboard/${uid}`
                    );

                await leaderboardRef.transaction(
                    current => {

                        current =
                            current || {};

                        const oldTotal =
                            Number(
                                current.total_win
                                || 0
                            );

                        current.uid =
                            uid;

                        current.name =
                            userName;

                        current.profile_image =
                            profileImage;

                        current.total_win =
                            oldTotal + payout;

                        current.last_win =
                            payout;

                        current.last_food =
                            winner.name;

                        current.last_round =
                            roundId;

                        current.updated_at =
                            admin.database
                                .ServerValue
                                .TIMESTAMP;

                        return current;
                    }
                );

                console.log("=================================");
                console.log("PAYOUT SUCCESS");
                console.log("UID:", uid);
                console.log("ROUND:", roundId);
                console.log("FOOD:", winner.name);
                console.log("BET:", winningBet);
                console.log("MULTIPLIER:", winner.multiplier);
                console.log("PAYOUT:", payout);
                console.log("NEW BALANCE:", newBalance);
                console.log("=================================");

                return res.json({
                    success: true,

                    alreadySettled:
                        false,

                    roundId:
                        roundId,

                    food:
                        winner.key,

                    foodName:
                        winner.name,

                    bet:
                        winningBet,

                    multiplier:
                        winner.multiplier,

                    win:
                        payout,

                    payout:
                        payout,

                    todayWin:
                        todayWinAfter,

                    diamonds:
                        newBalance,

                    serverDiamonds:
                        newBalance
                });
            }
        );

    } catch (error) {
        console.error(
            "SETTLE ERROR:",
            error
        );

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

app.get(
    "/game/top3/:roundId",
    async (req, res) => {

        try {
            const roundId =
                cleanString(
                    req.params.roundId
                );

            if (!roundId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Round ID missing"
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
                        uid:
                            uid,
                        ...results[uid]
                    }))
                    .filter(
                        item =>
                            Number(
                                item.win || 0
                            ) > 0
                    )
                    .sort(
                        (a, b) =>
                            Number(
                                b.win || 0
                            ) -
                            Number(
                                a.win || 0
                            )
                    )
                    .slice(0, 3);

            return res.json({
                success:
                    true,

                roundId:
                    roundId,

                top3:
                    top3
            });

        } catch (error) {
            console.error(
                "TOP3 ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to get top3"
            });
        }
    }
);

// =====================================================
// ROUND RESULTS
// =====================================================

app.get(
    "/game/results/:roundId",
    async (req, res) => {

        try {
            const roundId =
                cleanString(
                    req.params.roundId
                );

            if (!roundId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Round ID missing"
                });
            }

            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once("value");

            return res.json({
                success:
                    true,

                roundId:
                    roundId,

                results:
                    snapshot.val() || {}
            });

        } catch (error) {
            console.error(
                "RESULTS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to get results"
            });
        }
    }
);

// =====================================================
// HISTORY
// =====================================================

app.get(
    "/game/history",
    async (req, res) => {

        try {
            const snapshot =
                await db.ref(
                    "food_game_global/result_history"
                ).once("value");

            const data =
                snapshot.val() || {};

            const history =
                Object.keys(data)
                    .map(key => ({
                        id:
                            key,
                        ...data[key]
                    }))
                    .sort(
                        (a, b) =>
                            Number(
                                b.createdAt || 0
                            ) -
                            Number(
                                a.createdAt || 0
                            )
                    )
                    .slice(0, 20);

            return res.json({
                success:
                    true,

                history:
                    history
            });

        } catch (error) {
            console.error(
                "HISTORY ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Unable to get history"
            });
        }
    }
);

// =====================================================
// CONFIG
// =====================================================

app.get(
    "/game/config",
    (req, res) => {

        return res.json({
            success:
                true,

            betDuration:
                BET_DURATION,

            spinDuration:
                SPIN_DURATION,

            showDuration:
                SHOW_DURATION,

            foods:
                FOODS.map(food => ({
                    index:
                        food.index,

                    key:
                        food.key,

                    name:
                        food.name,

                    multiplier:
                        food.multiplier,

                    weight:
                        food.weight
                }))
        });
    }
);

// =====================================================
// HEALTH
// =====================================================

app.get("/", (req, res) => {
    return res.json({
        success:
            true,

        server:
            "VibeCash Food Game Server",

        status:
            "online",

        firebaseProject:
            serviceAccount.project_id,

        time:
            now()
    });
});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {
    return res.status(404).json({
        success:
            false,

        error:
            "Endpoint not found",

        path:
            req.path
    });
});

// =====================================================
// EXPRESS ERROR HANDLER
// =====================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "EXPRESS ERROR:",
            error
        );

        return res.status(500).json({
            success:
                false,

            error:
                "Internal server error"
        });
    }
);

// =====================================================
// START
// =====================================================

app.listen(
    PORT,
    () => {

        console.log(
            "================================="
        );

        console.log(
            "VIBECASH FOOD GAME SERVER ONLINE"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "BET:",
            BET_DURATION / 1000,
            "seconds"
        );

        console.log(
            "SPIN:",
            SPIN_DURATION / 1000,
            "seconds"
        );

        console.log(
            "RESULT:",
            SHOW_DURATION / 1000,
            "seconds"
        );

        console.log(
            "FOODS:",
            FOODS.length
        );

        console.log(
            "FIREBASE PROJECT:",
            serviceAccount.project_id
        );

        console.log(
            "DATABASE:",
            FIREBASE_DATABASE_URL
        );

        console.log(
            "================================="
        );
    }
);
