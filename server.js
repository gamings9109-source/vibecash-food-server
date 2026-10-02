// =====================================================
// VIBECASH FOOD GAME SERVER
// RENDER + NODE.JS + EXPRESS + FIREBASE ADMIN
// SERVER AUTHORITATIVE VERSION
// =====================================================

const express = require("express");
const cors = require("cors");

const {
    initializeApp,
    cert
} = require("firebase-admin/app");

const {
    getAuth
} = require("firebase-admin/auth");

const {
    getDatabase,
    ServerValue
} = require("firebase-admin/database");


// =====================================================
// EXPRESS
// =====================================================

const app = express();

app.use(cors());

app.use(
    express.json({
        limit: "1mb"
    })
);


// =====================================================
// ENVIRONMENT
// =====================================================

const PORT =
    Number(process.env.PORT) || 10000;

const FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL;

const FIREBASE_SERVICE_ACCOUNT =
    process.env.FIREBASE_SERVICE_ACCOUNT;


// =====================================================
// ENV CHECK
// =====================================================

if (!FIREBASE_DATABASE_URL) {

    console.error(
        "FIREBASE_DATABASE_URL is missing"
    );

    process.exit(1);
}

if (!FIREBASE_SERVICE_ACCOUNT) {

    console.error(
        "FIREBASE_SERVICE_ACCOUNT is missing"
    );

    process.exit(1);
}


// =====================================================
// SERVICE ACCOUNT
// =====================================================

let serviceAccount;

try {

    serviceAccount =
        JSON.parse(
            FIREBASE_SERVICE_ACCOUNT
        );

} catch (error) {

    console.error(
        "Invalid FIREBASE_SERVICE_ACCOUNT JSON"
    );

    console.error(
        error.message
    );

    process.exit(1);
}


if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
) {

    console.error(
        "Firebase service account is incomplete"
    );

    process.exit(1);
}


// Render env normally contains escaped \\n.
serviceAccount.private_key =
    String(
        serviceAccount.private_key
    ).replace(
        /\\n/g,
        "\n"
    );


// =====================================================
// FIREBASE ADMIN
// =====================================================

try {

    initializeApp({

        credential:
            cert(serviceAccount),

        databaseURL:
            FIREBASE_DATABASE_URL

    });

} catch (error) {

    console.error(
        "Firebase initialization failed"
    );

    console.error(error);

    process.exit(1);
}


const auth =
    getAuth();

const db =
    getDatabase();


// =====================================================
// GAME CONFIG
// =====================================================

const BET_DURATION =
    30 * 1000;

const SPIN_DURATION =
    5 * 1000;

const SHOW_DURATION =
    4 * 1000;

const SETTLEMENT_LOCK_TIMEOUT =
    60 * 1000;

const ALLOWED_BETS = [
    10,
    100,
    500,
    1000,
    5000,
    10000,
    100000
];


// =====================================================
// FOOD CONFIG
// =====================================================

const FOODS = [

    {
        index: 0,
        key: "apple",
        name: "Apple",
        multiplier: 5,
        weight: 20
    },

    {
        index: 1,
        key: "mango",
        name: "Mango",
        multiplier: 5,
        weight: 20
    },

    {
        index: 2,
        key: "strawberry",
        name: "Strawberry",
        multiplier: 5,
        weight: 20
    },

    {
        index: 3,
        key: "lemon",
        name: "Lemon",
        multiplier: 5,
        weight: 20
    },

    {
        index: 4,
        key: "fish",
        name: "Fish",
        multiplier: 10,
        weight: 8
    },

    {
        index: 5,
        key: "burger",
        name: "Burger",
        multiplier: 15,
        weight: 5
    },

    {
        index: 6,
        key: "pizza",
        name: "Pizza",
        multiplier: 25,
        weight: 4
    },

    {
        index: 7,
        key: "chicken",
        name: "Chicken",
        multiplier: 45,
        weight: 3
    }

];


// =====================================================
// TIME
// =====================================================

function now() {
    return Date.now();
}


// =====================================================
// GET FOOD
// =====================================================

function getFoodByKey(key) {

    if (
        key === undefined ||
        key === null
    ) {
        return null;
    }

    const cleanKey =
        String(key)
            .trim()
            .toLowerCase();

    return (
        FOODS.find(
            food =>
                food.key === cleanKey
        ) || null
    );
}


// =====================================================
// NORMALIZE FOOD
// =====================================================

function normalizeFoodInput(body) {

    if (!body) {
        return "";
    }

    let input = "";

    if (
        body.food !== undefined &&
        body.food !== null &&
        String(body.food).trim() !== ""
    ) {

        input =
            body.food;

    } else if (
        body.foodKey !== undefined &&
        body.foodKey !== null &&
        String(body.foodKey).trim() !== ""
    ) {

        input =
            body.foodKey;

    } else if (
        body.foodName !== undefined &&
        body.foodName !== null &&
        String(body.foodName).trim() !== ""
    ) {

        input =
            body.foodName;
    }

    if (!input) {
        return "";
    }

    const value =
        String(input)
            .trim()
            .toLowerCase();

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

    return (
        nameMap[value] ||
        value
    );
}


// =====================================================
// WEIGHTED WINNER
// =====================================================

function chooseWeightedFood() {

    let totalWeight = 0;

    for (const food of FOODS) {

        totalWeight +=
            Number(food.weight);
    }

    let roll =
        Math.random() * totalWeight;

    for (const food of FOODS) {

        roll -=
            Number(food.weight);

        if (roll <= 0) {
            return food;
        }
    }

    return FOODS[0];
}


// =====================================================
// VERIFY USER
// =====================================================

async function verifyUser(req) {

    const authorization =
        req.headers.authorization;

    if (!authorization) {

        throw new Error(
            "Authorization token missing"
        );
    }

    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {

        throw new Error(
            "Invalid authorization header"
        );
    }

    const token =
        authorization
            .substring(7)
            .trim();

    if (!token) {

        throw new Error(
            "Authorization token missing"
        );
    }

    return await auth.verifyIdToken(
        token
    );
}


// =====================================================
// USER LOCKS
// =====================================================

const userLocks =
    new Map();


async function withUserLock(
    uid,
    work
) {

    const previous =
        userLocks.get(uid) ||
        Promise.resolve();

    let release;

    const current =
        new Promise(
            resolve => {
                release = resolve;
            }
        );

    userLocks.set(
        uid,
        current
    );

    await previous.catch(
        () => {}
    );

    try {

        return await work();

    } finally {

        release();

        if (
            userLocks.get(uid) ===
            current
        ) {

            userLocks.delete(uid);
        }
    }
}


// =====================================================
// ROUND SETTLEMENT LOCKS
// =====================================================

const roundSettleLocks =
    new Set();


// =====================================================
// ROUND ID
// =====================================================

function createRoundId() {
    return String(now());
}


// =====================================================
// CREATE NEW ROUND
// =====================================================

async function createNewRound() {

    const currentRef =
        db.ref(
            "food_game_global/current"
        );

    const result =
        await currentRef.transaction(

            current => {

                const currentTime =
                    now();

                if (
                    current &&
                    current.roundId &&
                    Number(current.endAt) >
                    currentTime
                ) {

                    return current;
                }

                const roundId =
                    createRoundId();

                const startAt =
                    currentTime + 1000;

                const betEndAt =
                    startAt +
                    BET_DURATION;

                const spinEndAt =
                    betEndAt +
                    SPIN_DURATION;

                const endAt =
                    spinEndAt +
                    SHOW_DURATION;

                return {

                    roundId:
                        roundId,

                    startAt:
                        startAt,

                    betEndAt:
                        betEndAt,

                    spinEndAt:
                        spinEndAt,

                    endAt:
                        endAt,

                    phase:
                        "betting",

                    winnerIndex:
                        -1,

                    winnerKey:
                        "",

                    winnerName:
                        "",

                    winnerMultiplier:
                        0,

                    createdAt:
                        ServerValue.TIMESTAMP

                };
            }
        );

    if (!result.committed) {

        throw new Error(
            "Unable to create round"
        );
    }

    const round =
        result.snapshot.val();

    if (
        round &&
        round.roundId
    ) {

        const roundRef =
            db.ref(
                `food_game_global/rounds/${round.roundId}`
            );

        const snapshot =
            await roundRef.once(
                "value"
            );

        if (!snapshot.exists()) {

            await roundRef.set({

                roundId:
                    round.roundId,

                startAt:
                    Number(round.startAt),

                betEndAt:
                    Number(round.betEndAt),

                spinEndAt:
                    Number(round.spinEndAt),

                endAt:
                    Number(round.endAt),

                phase:
                    "betting",

                winnerIndex:
                    -1,

                winnerKey:
                    "",

                winnerName:
                    "",

                winnerMultiplier:
                    0,

                createdAt:
                    ServerValue.TIMESTAMP

            });
        }
    }

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
        await ref.once(
            "value"
        );

    const round =
        snapshot.val();

    if (
        !round ||
        !round.roundId
    ) {

        return await createNewRound();
    }

    if (
        Number(round.endAt) <=
        now()
    ) {

        return await createNewRound();
    }

    return round;
}


// =====================================================
// CHOOSE WINNER
// =====================================================

async function chooseWinner(roundId) {

    const currentRef =
        db.ref(
            "food_game_global/current"
        );

    const randomWinner =
        chooseWeightedFood();

    const result =
        await currentRef.transaction(

            current => {

                if (!current) {
                    return;
                }

                if (
                    current.roundId !==
                    roundId
                ) {

                    return current;
                }

                if (
                    Number(
                        current.winnerIndex
                    ) >= 0
                ) {

                    return current;
                }

                current.winnerIndex =
                    randomWinner.index;

                current.winnerKey =
                    randomWinner.key;

                current.winnerName =
                    randomWinner.name;

                current.winnerMultiplier =
                    randomWinner.multiplier;

                current.phase =
                    "spin";

                return current;
            }
        );

    if (!result.committed) {
        return null;
    }

    const finalRound =
        result.snapshot.val();

    if (
        finalRound &&
        finalRound.roundId
    ) {

        await db.ref(
            `food_game_global/rounds/${roundId}`
        ).update({

            winnerIndex:
                Number(
                    finalRound.winnerIndex
                ),

            winnerKey:
                finalRound.winnerKey,

            winnerName:
                finalRound.winnerName,

            winnerMultiplier:
                Number(
                    finalRound.winnerMultiplier
                ),

            phase:
                "spin"

        });
    }

    console.log(
        "================================="
    );

    console.log(
        "WINNER SELECTED"
    );

    console.log(
        "ROUND:",
        roundId
    );

    console.log(
        "FOOD:",
        finalRound.winnerName
    );

    console.log(
        "KEY:",
        finalRound.winnerKey
    );

    console.log(
        "MULTIPLIER:",
        finalRound.winnerMultiplier
    );

    console.log(
        "================================="
    );

    return getFoodByKey(
        finalRound.winnerKey
    );
}


// =====================================================
// USER PROFILE
// =====================================================

async function getUserProfile(uid) {

    const snapshot =
        await db.ref(
            `users/${uid}`
        ).once(
            "value"
        );

    const user =
        snapshot.val() || {};

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

    return {

        name:
            userName,

        profileImage:
            profileImage

    };
}


// =====================================================
// INDIA DATE
// =====================================================

function getIndiaDate() {

    return new Intl.DateTimeFormat(
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
}


// =====================================================
// UPDATE TODAY WIN
// =====================================================

async function updateTodayWin(
    uid,
    payout
) {

    const todayRef =
        db.ref(
            `users/${uid}/food_game_today`
        );

    const indiaDate =
        getIndiaDate();

    await todayRef.transaction(

        current => {

            current =
                current || {};

            const savedDate =
                String(
                    current.date || ""
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

            current.date =
                indiaDate;

            current.win =
                oldWin +
                payout;

            return current;
        }
    );
}


// =====================================================
// CLAIM SETTLEMENT
// =====================================================

async function claimSettlement(
    settlementRef,
    uid,
    roundId,
    winner,
    winningBet,
    payout
) {

    const claimId =
        `${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 10)}`;

    const transaction =
        await settlementRef.transaction(

            current => {

                if (
                    current &&
                    current.status ===
                    "paid"
                ) {

                    return current;
                }

                if (
                    current &&
                    current.status ===
                    "processing"
                ) {

                    const processingAt =
                        Number(
                            current.processingAt ||
                            0
                        );

                    if (
                        processingAt > 0 &&
                        now() -
                        processingAt <
                        SETTLEMENT_LOCK_TIMEOUT
                    ) {

                        return current;
                    }
                }

                return {

                    status:
                        "processing",

                    claimId:
                        claimId,

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

                    payout:
                        payout,

                    processingAt:
                        now()

                };
            }
        );

    const claimed =
        transaction.snapshot.val();

    if (
        claimed &&
        claimed.status ===
        "paid"
    ) {

        return {

            claimed:
                false,

            alreadyPaid:
                true,

            data:
                claimed

        };
    }

    if (
        !claimed ||
        claimed.claimId !==
        claimId
    ) {

        return {

            claimed:
                false,

            alreadyPaid:
                false,

            processing:
                true,

            data:
                claimed

        };
    }

    return {

        claimed:
            true,

        alreadyPaid:
            false,

        processing:
            false,

        claimId:
            claimId,

        data:
            claimed

    };
}


// =====================================================
// APPLY PAYOUT ATOMICALLY
// =====================================================

async function applyPayout(
    uid,
    roundId,
    winner,
    winningBet,
    payout,
    claimId
) {

    const profile =
        await getUserProfile(uid);

    const settlementPath =
        `food_game_global/rounds/${roundId}/settlements/${uid}`;

    const resultPath =
        `food_game_global/rounds/${roundId}/results/${uid}`;

    const leaderboardPath =
        `food_game_global/leaderboard/${uid}`;

    const updates = {};

    // Diamond payout
    updates[
        `users/${uid}/diamonds`
    ] =
        ServerValue.increment(
            payout
        );

    // Mark settlement paid
    updates[
        settlementPath
    ] = {

        status:
            "paid",

        uid:
            uid,

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

        claimId:
            claimId,

        paidAt:
            ServerValue.TIMESTAMP

    };

    // Round result
    updates[
        resultPath
    ] = {

        uid:
            uid,

        name:
            profile.name,

        profile_image:
            profile.profileImage,

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

        round:
            roundId,

        time:
            ServerValue.TIMESTAMP

    };

    // Leaderboard
    updates[
        `${leaderboardPath}/uid`
    ] =
        uid;

    updates[
        `${leaderboardPath}/name`
    ] =
        profile.name;

    updates[
        `${leaderboardPath}/profile_image`
    ] =
        profile.profileImage;

    updates[
        `${leaderboardPath}/total_win`
    ] =
        ServerValue.increment(
            payout
        );

    updates[
        `${leaderboardPath}/last_win`
    ] =
        payout;

    updates[
        `${leaderboardPath}/last_food`
    ] =
        winner.name;

    updates[
        `${leaderboardPath}/last_round`
    ] =
        roundId;

    updates[
        `${leaderboardPath}/updated_at`
    ] =
        ServerValue.TIMESTAMP;

    // One atomic multi-location update.
    await db.ref().update(
        updates
    );

    // Today win is separate; payout is already safely paid.
    try {

        await updateTodayWin(
            uid,
            payout
        );

    } catch (todayError) {

        console.error(
            "TODAY WIN UPDATE ERROR:",
            uid,
            todayError
        );
    }

    const balanceSnapshot =
        await db.ref(
            `users/${uid}/diamonds`
        ).once(
            "value"
        );

    const newBalance =
        Number(
            balanceSnapshot.val() || 0
        );

    return {

        newBalance:
            newBalance,

        profile:
            profile

    };
}


// =====================================================
// SETTLE ONE USER
// =====================================================

async function settleUserForRound(
    uid,
    roundId,
    winner
) {

    const winningBetSnapshot =
        await db.ref(
            `food_game_global/rounds/${roundId}/bets/${uid}/${winner.key}`
        ).once(
            "value"
        );

    const winningBet =
        Number(
            winningBetSnapshot.val() || 0
        );

    if (
        !Number.isFinite(winningBet) ||
        winningBet <= 0
    ) {

        return {

            success:
                true,

            paid:
                false,

            payout:
                0

        };
    }

    const payout =
        winningBet *
        winner.multiplier;

    const settlementRef =
        db.ref(
            `food_game_global/rounds/${roundId}/settlements/${uid}`
        );

    const claim =
        await claimSettlement(
            settlementRef,
            uid,
            roundId,
            winner,
            winningBet,
            payout
        );

    if (
        claim.alreadyPaid
    ) {

        const balanceSnapshot =
            await db.ref(
                `users/${uid}/diamonds`
            ).once(
                "value"
            );

        return {

            success:
                true,

            paid:
                true,

            alreadyPaid:
                true,

            bet:
                Number(
                    claim.data.bet || 0
                ),

            payout:
                Number(
                    claim.data.payout ||
                    claim.data.win ||
                    0
                ),

            diamonds:
                Number(
                    balanceSnapshot.val() || 0
                )

        };
    }

    if (
        !claim.claimed
    ) {

        return {

            success:
                true,

            paid:
                false,

            processing:
                true,

            payout:
                0

        };
    }

    const payoutResult =
        await applyPayout(
            uid,
            roundId,
            winner,
            winningBet,
            payout,
            claim.claimId
        );

    console.log(
        "*********************************"
    );

    console.log(
        "WINNER PAID SUCCESSFULLY"
    );

    console.log(
        "UID:",
        uid
    );

    console.log(
        "ROUND:",
        roundId
    );

    console.log(
        "FOOD:",
        winner.name
    );

    console.log(
        "BET:",
        winningBet
    );

    console.log(
        "MULTIPLIER:",
        winner.multiplier
    );

    console.log(
        "PAYOUT:",
        payout
    );

    console.log(
        "NEW DIAMONDS:",
        payoutResult.newBalance
    );

    console.log(
        "*********************************"
    );

    return {

        success:
            true,

        paid:
            true,

        alreadyPaid:
            false,

        bet:
            winningBet,

        payout:
            payout,

        diamonds:
            payoutResult.newBalance

    };
}


// =====================================================
// AUTO SETTLE ROUND
// =====================================================

async function autoSettleRound(
    roundId
) {

    if (
        roundSettleLocks.has(
            roundId
        )
    ) {

        return;
    }

    roundSettleLocks.add(
        roundId
    );

    try {

        console.log(
            "================================="
        );

        console.log(
            "AUTO SETTLEMENT START"
        );

        console.log(
            "ROUND:",
            roundId
        );

        const roundSnapshot =
            await db.ref(
                `food_game_global/rounds/${roundId}`
            ).once(
                "value"
            );

        const round =
            roundSnapshot.val();

        if (!round) {

            console.log(
                "ROUND NOT FOUND:",
                roundId
            );

            return;
        }

        const winner =
            getFoodByKey(
                round.winnerKey
            );

        if (
            !winner ||
            Number(round.winnerIndex) < 0
        ) {

            console.log(
                "WINNER NOT FOUND"
            );

            return;
        }

        const betsSnapshot =
            await db.ref(
                `food_game_global/rounds/${roundId}/bets`
            ).once(
                "value"
            );

        const allBets =
            betsSnapshot.val() || {};

        const userIds =
            Object.keys(allBets);

        console.log(
            "TOTAL BET USERS:",
            userIds.length
        );

        console.log(
            "WINNER:",
            winner.name
        );

        console.log(
            "MULTIPLIER:",
            winner.multiplier
        );

        for (
            const uid of userIds
        ) {

            try {

                const result =
                    await withUserLock(
                        uid,
                        async () =>
                            await settleUserForRound(
                                uid,
                                roundId,
                                winner
                            )
                    );

                if (
                    result.paid
                ) {

                    console.log(
                        "AUTO PAID:",
                        uid,
                        result.payout
                    );
                }

            } catch (userError) {

                console.error(
                    "AUTO SETTLEMENT USER ERROR:",
                    uid,
                    userError
                );
            }
        }

        console.log(
            "AUTO SETTLEMENT FINISHED:",
            roundId
        );

    } catch (error) {

        console.error(
            "AUTO SETTLEMENT ERROR:",
            error
        );

    } finally {

        roundSettleLocks.delete(
            roundId
        );
    }
}


// =====================================================
// UPDATE ROUND PHASE
// =====================================================

async function updateRoundPhase(
    round
) {

    if (!round) {
        return;
    }

    const currentTime =
        now();

    let phase;

    if (
        currentTime <
        Number(round.betEndAt)
    ) {

        phase =
            "betting";

    } else if (
        currentTime <
        Number(round.spinEndAt)
    ) {

        phase =
            "spin";

    } else if (
        currentTime <
        Number(round.endAt)
    ) {

        phase =
            "result";

    } else {

        return;
    }

    if (
        phase !==
        round.phase
    ) {

        await db.ref(
            "food_game_global/current"
        ).update({

            phase:
                phase

        });

        await db.ref(
            `food_game_global/rounds/${round.roundId}`
        ).update({

            phase:
                phase

        });
    }
}


// =====================================================
// SAVE RESULT HISTORY
// =====================================================

async function saveResultHistory(
    round
) {

    if (
        !round ||
        !round.roundId ||
        !round.winnerKey
    ) {

        return;
    }

    const winner =
        getFoodByKey(
            round.winnerKey
        );

    if (!winner) {
        return;
    }

    const ref =
        db.ref(
            `food_game_global/result_history/${round.roundId}`
        );

    const snapshot =
        await ref.once(
            "value"
        );

    if (
        snapshot.exists()
    ) {

        return;
    }

    await ref.set({

        roundId:
            round.roundId,

        food:
            winner.key,

        foodName:
            winner.name,

        multiplier:
            winner.multiplier,

        createdAt:
            ServerValue.TIMESTAMP

    });
}


// =====================================================
// GAME STATE
// =====================================================

app.get(
    "/game/state",
    async (
        req,
        res
    ) => {

        try {

            let round =
                await getCurrentRound();

            let currentTime =
                now();

            if (
                currentTime >=
                Number(round.betEndAt) &&
                Number(round.winnerIndex) < 0
            ) {

                await chooseWinner(
                    round.roundId
                );

                round =
                    await getCurrentRound();
            }

            currentTime =
                now();

            if (
                Number(round.winnerIndex) >= 0 &&
                currentTime >=
                Number(round.spinEndAt)
            ) {

                await autoSettleRound(
                    round.roundId
                );
            }

            await updateRoundPhase(
                round
            );

            round =
                await getCurrentRound();

            currentTime =
                now();

            if (
                Number(round.winnerIndex) >= 0 &&
                currentTime >=
                Number(round.spinEndAt)
            ) {

                await saveResultHistory(
                    round
                );
            }

            return res.json({

                success:
                    true,

                roundId:
                    String(round.roundId),

                startAt:
                    Number(round.startAt),

                betEndAt:
                    Number(round.betEndAt),

                spinEndAt:
                    Number(round.spinEndAt),

                endAt:
                    Number(round.endAt),

                phase:
                    round.phase,

                winnerIndex:
                    Number(round.winnerIndex),

                winnerKey:
                    round.winnerKey || "",

                winnerName:
                    round.winnerName || "",

                winnerMultiplier:
                    Number(
                        round.winnerMultiplier || 0
                    ),

                serverTime:
                    currentTime

            });

        } catch (error) {

            console.error(
                "STATE ERROR:",
                error
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get game state"

            });
        }
    }
);


// =====================================================
// PLACE BET
// =====================================================

app.post(
    "/game/bet",
    async (
        req,
        res
    ) => {

        try {

            const decoded =
                await verifyUser(req);

            const uid =
                decoded.uid;

            console.log(
                "================================="
            );

            console.log(
                "BET REQUEST"
            );

            console.log(
                "UID:",
                uid
            );

            console.log(
                "BODY:",
                req.body
            );

            const rawAmount =
                req.body
                    ? req.body.amount
                    : null;

            const amount =
                Number(rawAmount);

            if (
                !Number.isSafeInteger(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Invalid bet amount",

                    receivedAmount:
                        rawAmount

                });
            }

            if (
                !ALLOWED_BETS.includes(amount)
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Bet amount not allowed",

                    receivedAmount:
                        amount,

                    allowedBets:
                        ALLOWED_BETS

                });
            }

            const foodInput =
                normalizeFoodInput(
                    req.body
                );

            const food =
                getFoodByKey(
                    foodInput
                );

            if (!food) {

                return res.status(400).json({

                    success:
                        false,

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

                            success:
                                false,

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

                            success:
                                false,

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

                    // Read first for useful diagnostics.
                    const beforeSnapshot =
                        await diamondRef.once(
                            "value"
                        );

                    const rawServerBalance =
                        beforeSnapshot.val();

                    const serverBalance =
                        Number(
                            rawServerBalance
                        );

                    console.log(
                        "SERVER DIAMOND RAW:",
                        rawServerBalance
                    );

                    console.log(
                        "SERVER DIAMOND TYPE:",
                        typeof rawServerBalance
                    );

                    console.log(
                        "SERVER DIAMOND NUMBER:",
                        serverBalance
                    );

                    if (
                        rawServerBalance === null ||
                        rawServerBalance === undefined
                    ) {

                        return res.status(500).json({

                            success:
                                false,

                            error:
                                "Server diamonds node not found",

                            uid:
                                uid,

                            path:
                                `users/${uid}/diamonds`,

                            serverDiamonds:
                                null

                        });
                    }

                    if (
                        !Number.isFinite(
                            serverBalance
                        )
                    ) {

                        return res.status(500).json({

                            success:
                                false,

                            error:
                                "Invalid server diamonds value",

                            uid:
                                uid,

                            serverDiamonds:
                                rawServerBalance,

                            type:
                                typeof rawServerBalance

                        });
                    }

                    if (
                        serverBalance <
                        amount
                    ) {

                        return res.status(400).json({

                            success:
                                false,

                            error:
                                "Not enough diamonds",

                            serverDiamonds:
                                serverBalance,

                            receivedAmount:
                                amount,

                            uid:
                                uid,

                            roundId:
                                round.roundId

                        });
                    }

                    // Atomic deduction.
                    const diamondTransaction =
                        await diamondRef.transaction(

                            current => {

                                console.log(
                                    "TRANSACTION CURRENT:",
                                    current,
                                    "TYPE:",
                                    typeof current
                                );

                                if (
                                    current === null ||
                                    current === undefined
                                ) {

                                    return;
                                }

                                const balance =
                                    Number(current);

                                if (
                                    !Number.isFinite(
                                        balance
                                    )
                                ) {

                                    return;
                                }

                                if (
                                    balance <
                                    amount
                                ) {

                                    return;
                                }

                                const newBalance =
                                    balance -
                                    amount;

                                if (
                                    newBalance < 0
                                ) {

                                    return;
                                }

                                return newBalance;
                            }
                        );

                    console.log(
                        "TRANSACTION COMMITTED:",
                        diamondTransaction.committed
                    );

                    console.log(
                        "TRANSACTION SNAPSHOT:",
                        diamondTransaction.snapshot.val()
                    );

                    if (
                        !diamondTransaction.committed
                    ) {

                        const latestSnapshot =
                            await diamondRef.once(
                                "value"
                            );

                        const latestRaw =
                            latestSnapshot.val();

                        const latestBalance =
                            Number(
                                latestRaw
                            );

                        console.error(
                            "================================="
                        );

                        console.error(
                            "DIAMOND TRANSACTION FAILED"
                        );

                        console.error(
                            "UID:",
                            uid
                        );

                        console.error(
                            "PATH:",
                            `users/${uid}/diamonds`
                        );

                        console.error(
                            "RAW:",
                            latestRaw
                        );

                        console.error(
                            "TYPE:",
                            typeof latestRaw
                        );

                        console.error(
                            "NUMBER:",
                            latestBalance
                        );

                        console.error(
                            "BET:",
                            amount
                        );

                        console.error(
                            "================================="
                        );

                        if (
                            Number.isFinite(
                                latestBalance
                            ) &&
                            latestBalance <
                            amount
                        ) {

                            return res.status(400).json({

                                success:
                                    false,

                                error:
                                    "Not enough diamonds",

                                serverDiamonds:
                                    latestBalance,

                                receivedAmount:
                                    amount,

                                uid:
                                    uid,

                                roundId:
                                    round.roundId

                            });
                        }

                        return res.status(500).json({

                            success:
                                false,

                            error:
                                "Diamond deduction failed",

                            serverDiamonds:
                                Number.isFinite(
                                    latestBalance
                                )
                                    ? latestBalance
                                    : null,

                            rawServerDiamonds:
                                latestRaw,

                            diamondType:
                                typeof latestRaw,

                            receivedAmount:
                                amount,

                            uid:
                                uid,

                            path:
                                `users/${uid}/diamonds`,

                            roundId:
                                round.roundId

                        });
                    }

                    const newBalance =
                        Number(
                            diamondTransaction
                                .snapshot
                                .val()
                        );

                    console.log(
                        "DIAMOND DEDUCTED:",
                        serverBalance,
                        "->",
                        newBalance
                    );

                    const betRef =
                        db.ref(
                            `food_game_global/rounds/${round.roundId}/bets/${uid}/${food.key}`
                        );

                    try {

                        const betTransaction =
                            await betRef.transaction(

                                current => {

                                    const oldBet =
                                        Number(
                                            current || 0
                                        );

                                    if (
                                        !Number.isFinite(
                                            oldBet
                                        ) ||
                                        oldBet < 0
                                    ) {

                                        return;
                                    }

                                    return (
                                        oldBet +
                                        amount
                                    );
                                }
                            );

                        if (
                            !betTransaction.committed
                        ) {

                            throw new Error(
                                "Bet transaction failed"
                            );
                        }

                        const totalBet =
                            Number(
                                betTransaction
                                    .snapshot
                                    .val() || 0
                            );

                        const possibleWin =
                            totalBet *
                            food.multiplier;

                        console.log(
                            "================================="
                        );

                        console.log(
                            "BET SUCCESS"
                        );

                        console.log(
                            "UID:",
                            uid
                        );

                        console.log(
                            "ROUND:",
                            round.roundId
                        );

                        console.log(
                            "FOOD:",
                            food.key
                        );

                        console.log(
                            "AMOUNT:",
                            amount
                        );

                        console.log(
                            "TOTAL BET:",
                            totalBet
                        );

                        console.log(
                            "MULTIPLIER:",
                            food.multiplier
                        );

                        console.log(
                            "POSSIBLE WIN:",
                            possibleWin
                        );

                        console.log(
                            "DIAMONDS:",
                            newBalance
                        );

                        console.log(
                            "================================="
                        );

                        return res.json({

                            success:
                                true,

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

                            totalBet:
                                totalBet,

                            multiplier:
                                food.multiplier,

                            possibleWin:
                                possibleWin,

                            diamonds:
                                newBalance

                        });

                    } catch (betError) {

                        console.error(
                            "BET SAVE ERROR:",
                            betError
                        );

                        try {

                            await diamondRef.transaction(

                                current => {

                                    const balance =
                                        Number(
                                            current || 0
                                        );

                                    if (
                                        !Number.isFinite(
                                            balance
                                        )
                                    ) {

                                        return;
                                    }

                                    return (
                                        balance +
                                        amount
                                    );
                                }
                            );

                            console.log(
                                "REFUND SUCCESS:",
                                amount
                            );

                        } catch (refundError) {

                            console.error(
                                "REFUND ERROR:",
                                refundError
                            );

                            return res.status(500).json({

                                success:
                                    false,

                                error:
                                    "Bet save failed and refund failed",

                                details:
                                    refundError.message ||
                                    "",

                                uid:
                                    uid,

                                roundId:
                                    round.roundId

                            });
                        }

                        return res.status(500).json({

                            success:
                                false,

                            error:
                                "Bet save failed. Diamonds refunded.",

                            receivedAmount:
                                amount,

                            uid:
                                uid,

                            roundId:
                                round.roundId

                        });
                    }
                }
            );

        } catch (error) {

            console.error(
                "BET ERROR:",
                error
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    error.message ||
                    "Bet failed"

            });
        }
    }
);


// =====================================================
// SETTLE
// =====================================================

app.post(
    "/game/settle",
    async (
        req,
        res
    ) => {

        try {

            const decoded =
                await verifyUser(req);

            const uid =
                decoded.uid;

            const roundId =
                String(
                    req.body.roundId ||
                    ""
                ).trim();

            if (!roundId) {

                return res.status(400).json({

                    success:
                        false,

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
                        ).once(
                            "value"
                        );

                    const round =
                        roundSnapshot.val();

                    if (!round) {

                        return res.status(404).json({

                            success:
                                false,

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
                        Number(
                            round.winnerIndex
                        ) < 0
                    ) {

                        return res.status(400).json({

                            success:
                                false,

                            error:
                                "Winner not selected"

                        });
                    }

                    const result =
                        await settleUserForRound(
                            uid,
                            roundId,
                            winner
                        );

                    const balanceSnapshot =
                        await db.ref(
                            `users/${uid}/diamonds`
                        ).once(
                            "value"
                        );

                    const diamonds =
                        Number(
                            balanceSnapshot.val() || 0
                        );

                    if (
                        result.paid
                    ) {

                        return res.json({

                            success:
                                true,

                            alreadySettled:
                                Boolean(
                                    result.alreadyPaid
                                ),

                            roundId:
                                roundId,

                            food:
                                winner.key,

                            foodName:
                                winner.name,

                            bet:
                                Number(
                                    result.bet || 0
                                ),

                            multiplier:
                                winner.multiplier,

                            win:
                                Number(
                                    result.payout || 0
                                ),

                            payout:
                                Number(
                                    result.payout || 0
                                ),

                            diamonds:
                                diamonds

                        });
                    }

                    return res.json({

                        success:
                            true,

                        alreadySettled:
                            false,

                        processing:
                            Boolean(
                                result.processing
                            ),

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
                            diamonds

                    });
                }
            );

        } catch (error) {

            console.error(
                "SETTLE ERROR:",
                error
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    error.message ||
                    "Settlement failed"

            });
        }
    }
);


// =====================================================
// TOP 3
// =====================================================

app.get(
    "/game/top3/:roundId",
    async (
        req,
        res
    ) => {

        try {

            const roundId =
                String(
                    req.params.roundId ||
                    ""
                ).trim();

            if (!roundId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Round ID missing"

                });
            }

            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );

            const results =
                snapshot.val() || {};

            const top3 =
                Object.keys(results)
                    .map(
                        uid => ({
                            uid:
                                uid,
                            ...results[uid]
                        })
                    )
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
                    .slice(
                        0,
                        3
                    );

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

                success:
                    false,

                error:
                    "Unable to get top3"

            });
        }
    }
);


// =====================================================
// RESULTS
// =====================================================

app.get(
    "/game/results/:roundId",
    async (
        req,
        res
    ) => {

        try {

            const roundId =
                String(
                    req.params.roundId ||
                    ""
                ).trim();

            if (!roundId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Round ID missing"

                });
            }

            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );

            return res.json({

                success:
                    true,

                roundId:
                    roundId,

                results:
                    snapshot.val() ||
                    {}

            });

        } catch (error) {

            console.error(
                "RESULTS ERROR:",
                error
            );

            return res.status(500).json({

                success:
                    false,

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
    async (
        req,
        res
    ) => {

        try {

            const snapshot =
                await db.ref(
                    "food_game_global/result_history"
                )
                    .orderByChild(
                        "createdAt"
                    )
                    .once(
                        "value"
                    );

            const data =
                snapshot.val() || {};

            const history =
                Object.keys(data)
                    .map(
                        key => ({
                            id:
                                key,
                            ...data[key]
                        })
                    )
                    .sort(
                        (a, b) =>
                            Number(
                                b.createdAt || 0
                            ) -
                            Number(
                                a.createdAt || 0
                            )
                    )
                    .slice(
                        0,
                        8
                    );

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

                success:
                    false,

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
    (
        req,
        res
    ) => {

        return res.json({

            success:
                true,

            betDuration:
                BET_DURATION,

            spinDuration:
                SPIN_DURATION,

            showDuration:
                SHOW_DURATION,

            allowedBets:
                ALLOWED_BETS,

            foods:
                FOODS.map(
                    food => ({

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

                    })
                )

        });
    }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/",
    (
        req,
        res
    ) => {

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
    }
);


// =====================================================
// 404
// =====================================================

app.use(
    (
        req,
        res
    ) => {

        return res.status(404).json({

            success:
                false,

            error:
                "Endpoint not found",

            path:
                req.path

        });
    }
);


// =====================================================
// EXPRESS ERROR
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

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
// START SERVER
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
            "ALLOWED BETS:",
            ALLOWED_BETS
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
