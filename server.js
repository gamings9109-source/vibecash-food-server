// =====================================================
// VIBECASH FOOD GAME SERVER
// Global Food Betting Game
// Node.js + Express + Firebase Admin
// =====================================================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");


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
// ENVIRONMENT VARIABLES
// =====================================================

const PORT =
    process.env.PORT || 10000;

const FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL;

const FIREBASE_SERVICE_ACCOUNT =
    process.env.FIREBASE_SERVICE_ACCOUNT;


// =====================================================
// CHECK ENV
// =====================================================

if (!FIREBASE_SERVICE_ACCOUNT) {

    console.error(
        "FIREBASE_SERVICE_ACCOUNT environment variable is missing"
    );

    process.exit(1);
}


if (!FIREBASE_DATABASE_URL) {

    console.error(
        "FIREBASE_DATABASE_URL environment variable is missing"
    );

    process.exit(1);
}


// =====================================================
// FIREBASE ADMIN
// =====================================================

let serviceAccount;

try {

    serviceAccount =
        JSON.parse(
            FIREBASE_SERVICE_ACCOUNT
                .replace(/\\n/g, "\n")
        );

} catch (error) {

    console.error(
        "================================="
    );

    console.error(
        "FIREBASE SERVICE ACCOUNT JSON ERROR"
    );

    console.error(
        error.message
    );

    console.error(
        "================================="
    );

    process.exit(1);
}


// =====================================================
// SERVICE ACCOUNT CHECK
// =====================================================

if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
) {

    console.error(
        "Invalid Firebase service account JSON"
    );

    console.error(
        "Required: project_id, client_email, private_key"
    );

    process.exit(1);
}


// =====================================================
// FIREBASE INITIALIZE
// =====================================================

try {

    admin.initializeApp({

        credential:
            admin.credential.cert(
                serviceAccount
            ),

        databaseURL:
            FIREBASE_DATABASE_URL

    });

    console.log(
        "================================="
    );

    console.log(
        "Firebase Admin connected"
    );

    console.log(
        "Project:",
        serviceAccount.project_id
    );

    console.log(
        "Database:",
        FIREBASE_DATABASE_URL
    );

    console.log(
        "================================="
    );

} catch (error) {

    console.error(
        "Firebase initialization failed"
    );

    console.error(
        error
    );

    process.exit(1);
}


const db =
    admin.database();


// =====================================================
// GAME CONFIG
// =====================================================

const BET_DURATION =
    30 * 1000;

const SPIN_DURATION =
    5 * 1000;

const SHOW_DURATION =
    4 * 1000;


// =====================================================
// FOOD CONFIG
// =====================================================

const FOODS = [

    {
        key: "apple",
        name: "Apple",
        multiplier: 5,
        weight: 20
    },

    {
        key: "mango",
        name: "Mango",
        multiplier: 5,
        weight: 20
    },

    {
        key: "strawberry",
        name: "Strawberry",
        multiplier: 5,
        weight: 20
    },

    {
        key: "lemon",
        name: "Lemon",
        multiplier: 5,
        weight: 20
    },

    {
        key: "fish",
        name: "Fish",
        multiplier: 10,
        weight: 8
    },

    {
        key: "burger",
        name: "Burger",
        multiplier: 15,
        weight: 5
    },

    {
        key: "pizza",
        name: "Pizza",
        multiplier: 25,
        weight: 4
    },

    {
        key: "chicken",
        name: "Chicken",
        multiplier: 45,
        weight: 3
    }

];


// =====================================================
// HELPERS
// =====================================================

function now() {

    return Date.now();

}


function getFoodByKey(key) {

    return FOODS.find(
        item =>
            item.key === key
    );

}


// =====================================================
// RANDOM WINNER
// =====================================================

function chooseWeightedFood() {

    const totalWeight =
        FOODS.reduce(
            (total, food) =>
                total + food.weight,
            0
        );


    let random =
        Math.random() *
        totalWeight;


    for (
        const food of FOODS
    ) {

        random -=
            food.weight;

        if (
            random <= 0
        ) {

            return food;

        }

    }


    return FOODS[0];

}


// =====================================================
// FIREBASE AUTH
// =====================================================

async function verifyUser(req) {

    const authHeader =
        req.headers.authorization;


    if (
        !authHeader ||
        !authHeader.startsWith("Bearer ")
    ) {

        throw new Error(
            "Authorization token missing"
        );

    }


    const idToken =
        authHeader.substring(
            7
        );


    if (!idToken) {

        throw new Error(
            "Authorization token missing"
        );

    }


    const decodedUser =
        await admin
            .auth()
            .verifyIdToken(
                idToken
            );


    return decodedUser;

}


// =====================================================
// CREATE / GET CURRENT ROUND
// =====================================================

async function ensureRound() {

    const currentRef =
        db.ref(
            "food_game_global/current"
        );


    const snapshot =
        await currentRef.once(
            "value"
        );


    const current =
        snapshot.val();


    if (
        current &&
        current.roundId &&
        Number(current.endAt) > now()
    ) {

        return current;

    }


    const roundId =
        String(now());


    const startAt =
        now();


    const betEndAt =
        startAt +
        BET_DURATION;


    const spinEndAt =
        betEndAt +
        SPIN_DURATION;


    const endAt =
        spinEndAt +
        SHOW_DURATION;


    const round = {

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
            admin.database.ServerValue.TIMESTAMP

    };


    // -------------------------------------------------
    // Save current
    // -------------------------------------------------

    await currentRef.set(
        round
    );


    // -------------------------------------------------
    // Save historical round metadata
    // -------------------------------------------------

    await db.ref(
        `food_game_global/rounds/${roundId}`
    ).update({

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
            admin.database.ServerValue.TIMESTAMP

    });


    console.log(
        "NEW ROUND CREATED:",
        roundId
    );


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


    let round =
        snapshot.val();


    if (
        !round ||
        !round.roundId
    ) {

        round =
            await ensureRound();

    }


    return round;

}


// =====================================================
// CHOOSE WINNER
// =====================================================

async function chooseWinner(
    roundId
) {

    const currentRef =
        db.ref(
            "food_game_global/current"
        );


    const currentSnapshot =
        await currentRef.once(
            "value"
        );


    const current =
        currentSnapshot.val();


    if (
        !current ||
        current.roundId !== roundId
    ) {

        return null;

    }


    // -------------------------------------------------
    // Already selected
    // -------------------------------------------------

    if (
        Number(current.winnerIndex) >= 0
    ) {

        const existing =
            FOODS[
                Number(
                    current.winnerIndex
                )
            ];


        return existing || null;

    }


    // -------------------------------------------------
    // Random winner
    // -------------------------------------------------

    const winner =
        chooseWeightedFood();


    const winnerIndex =
        FOODS.findIndex(
            food =>
                food.key ===
                winner.key
        );


    // -------------------------------------------------
    // Current winner
    // -------------------------------------------------

    await currentRef.update({

        phase:
            "spin",

        winnerIndex:
            winnerIndex,

        winnerKey:
            winner.key,

        winnerName:
            winner.name,

        winnerMultiplier:
            winner.multiplier

    });


    // -------------------------------------------------
    // Historical winner
    // -------------------------------------------------

    await db.ref(
        `food_game_global/rounds/${roundId}`
    ).update({

        phase:
            "spin",

        winnerIndex:
            winnerIndex,

        winnerKey:
            winner.key,

        winnerName:
            winner.name,

        winnerMultiplier:
            winner.multiplier

    });


    console.log(
        "WINNER SELECTED"
    );

    console.log(
        "ROUND:",
        roundId
    );

    console.log(
        "WINNER:",
        winner.key
    );

    console.log(
        "MULTIPLIER:",
        winner.multiplier
    );


    return winner;

}


// =====================================================
// PROCESS GAME
// =====================================================

async function processRound() {

    try {

        const round =
            await getCurrentRound();


        if (!round) {

            return;

        }


        const currentTime =
            now();


        // =================================================
        // BETTING
        // =================================================

        if (
            currentTime <
            Number(round.betEndAt)
        ) {

            if (
                round.phase !==
                "betting"
            ) {

                await db.ref(
                    "food_game_global/current"
                ).update({

                    phase:
                        "betting"

                });

            }

            return;

        }


        // =================================================
        // SPIN
        // =================================================

        if (
            currentTime >=
            Number(round.betEndAt) &&
            currentTime <
            Number(round.spinEndAt)
        ) {

            if (
                Number(round.winnerIndex) < 0
            ) {

                await chooseWinner(
                    round.roundId
                );

            }


            return;

        }


        // =================================================
        // RESULT
        // =================================================

        if (
            currentTime >=
            Number(round.spinEndAt) &&
            currentTime <
            Number(round.endAt)
        ) {

            const winner =
                getFoodByKey(
                    round.winnerKey
                );


            if (
                winner
            ) {

                await db.ref(
                    "food_game_global/current"
                ).update({

                    phase:
                        "result",

                    winnerIndex:
                        FOODS.findIndex(
                            food =>
                                food.key ===
                                winner.key
                        ),

                    winnerKey:
                        winner.key,

                    winnerName:
                        winner.name,

                    winnerMultiplier:
                        winner.multiplier

                });


                await db.ref(
                    `food_game_global/rounds/${round.roundId}`
                ).update({

                    phase:
                        "result"

                });

            }


            return;

        }


        // =================================================
        // NEW ROUND
        // =================================================

        if (
            currentTime >=
            Number(round.endAt)
        ) {

            await ensureRound();

        }

    } catch (error) {

        console.error(
            "PROCESS ROUND ERROR:",
            error
        );

    }

}


// =====================================================
// GAME LOOP
// =====================================================

setInterval(
    processRound,
    500
);


// =====================================================
// HOME
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.json({

            success:
                true,

            server:
                "VibeCash Food Game",

            status:
                "online"

        });

    }
);


// =====================================================
// HEALTH
// =====================================================

app.get(
    "/health",
    (req, res) => {

        res.json({

            success:
                true,

            status:
                "healthy",

            time:
                now(),

            project:
                serviceAccount.project_id

        });

    }
);


// =====================================================
// GAME STATE
// =====================================================

app.get(
    "/game/state",
    async (req, res) => {

        try {

            const round =
                await getCurrentRound();


            const currentTime =
                now();


            let phase =
                "betting";


            if (
                currentTime >=
                Number(round.betEndAt) &&
                currentTime <
                Number(round.spinEndAt)
            ) {

                phase =
                    "spin";

            }


            else if (
                currentTime >=
                Number(round.spinEndAt) &&
                currentTime <
                Number(round.endAt)
            ) {

                phase =
                    "result";

            }


            else if (
                currentTime >=
                Number(round.endAt)
            ) {

                phase =
                    "new";

            }


            res.json({

                success:
                    true,

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

                serverTime:
                    currentTime,

                phase:
                    phase,

                winnerIndex:
                    Number(
                        round.winnerIndex ??
                        -1
                    ),

                winnerKey:
                    round.winnerKey ||
                    "",

                winnerName:
                    round.winnerName ||
                    "",

                winnerMultiplier:
                    Number(
                        round.winnerMultiplier ||
                        0
                    )

            });

        } catch (error) {

            console.error(
                "STATE ERROR:",
                error
            );


            res.status(500).json({

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
    async (req, res) => {

        try {

            // =============================================
            // VERIFY FIREBASE USER
            // =============================================

            const decodedUser =
                await verifyUser(req);

            const uid =
                decodedUser.uid;


            // =============================================
            // REQUEST DATA
            // =============================================

            const food =
                req.body.food;

            const amount =
                req.body.amount;


            console.log(
                "================================="
            );

            console.log(
                "FOOD BET REQUEST"
            );

            console.log(
                "UID:",
                uid
            );

            console.log(
                "FOOD:",
                food
            );

            console.log(
                "AMOUNT:",
                amount
            );


            // =============================================
            // VALIDATION
            // =============================================

            if (
                !food ||
                amount === undefined ||
                amount === null
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "food and amount required"

                });

            }


            const betAmount =
                Number(amount);


            if (
                !Number.isFinite(
                    betAmount
                ) ||
                betAmount <= 0 ||
                !Number.isInteger(
                    betAmount
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Invalid amount"

                });

            }


            // =============================================
            // FOOD CHECK
            // =============================================

            const foodData =
                getFoodByKey(food);


            if (!foodData) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Invalid food"

                });

            }


            // =============================================
            // CURRENT ROUND
            // =============================================

            const round =
                await getCurrentRound();


            if (!round) {

                return res.status(500).json({

                    success:
                        false,

                    error:
                        "Round unavailable"

                });

            }


            const currentTime =
                now();


            console.log(
                "ROUND:",
                round.roundId
            );

            console.log(
                "CURRENT TIME:",
                currentTime
            );

            console.log(
                "BET END:",
                Number(
                    round.betEndAt
                )
            );


            // =============================================
            // BETTING TIME
            // =============================================

            if (
                currentTime <
                Number(round.startAt)
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Round not started"

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
                        "Betting closed"

                });

            }


            // =============================================
            // DIAMOND PATH
            // =============================================

            const diamondRef =
                db.ref(
                    `users/${uid}/diamonds`
                );


            console.log(
                "DIAMOND PATH:",
                `users/${uid}/diamonds`
            );


            // =============================================
            // READ BEFORE
            // =============================================

            const beforeSnapshot =
                await diamondRef.once(
                    "value"
                );


            const beforeValue =
                beforeSnapshot.val();


            const beforeDiamonds =
                Number(
                    beforeValue || 0
                );


            console.log(
                "DIAMONDS BEFORE:",
                beforeDiamonds
            );

            console.log(
                "RAW DIAMONDS VALUE:",
                beforeValue
            );


            // =============================================
            // BALANCE CHECK
            // =============================================

            if (
                beforeDiamonds <
                betAmount
            ) {

                console.log(
                    "NOT ENOUGH DIAMONDS"
                );

                console.log(
                    "SERVER UID:",
                    uid
                );

                console.log(
                    "SERVER DIAMONDS:",
                    beforeDiamonds
                );

                console.log(
                    "BET:",
                    betAmount
                );


                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Not enough diamonds",

                    serverDiamonds:
                        beforeDiamonds,

                    uid:
                        uid

                });

            }


            // =============================================
            // ATOMIC DEDUCTION
            // =============================================

            const diamondResult =
                await diamondRef.transaction(

                    current => {

                        const diamonds =
                            Number(
                                current || 0
                            );


                        if (
                            diamonds <
                            betAmount
                        ) {

                            return;

                        }


                        return (
                            diamonds -
                            betAmount
                        );

                    }

                );


            // =============================================
            // TRANSACTION FAILED
            // =============================================

            if (
                !diamondResult.committed
            ) {

                const latestValue =
                    diamondResult
                        .snapshot
                        .val();


                const latestDiamonds =
                    Number(
                        latestValue || 0
                    );


                console.log(
                    "TRANSACTION NOT COMMITTED"
                );

                console.log(
                    "UID:",
                    uid
                );

                console.log(
                    "LATEST DIAMONDS:",
                    latestDiamonds
                );


                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Not enough diamonds",

                    serverDiamonds:
                        latestDiamonds

                });

            }


            // =============================================
            // NEW BALANCE
            // =============================================

            const balanceSnapshot =
                await diamondRef.once(
                    "value"
                );


            const newBalance =
                Number(
                    balanceSnapshot.val() ||
                    0
                );


            console.log(
                "DIAMONDS AFTER:",
                newBalance
            );


            // =============================================
            // SAVE BET
            // =============================================

            const betRef =
                db.ref(
                    `food_game_global/rounds/${round.roundId}/bets/${uid}/${foodData.key}`
                );


            try {

                await betRef.transaction(

                    current => {

                        return (
                            Number(
                                current || 0
                            ) +
                            betAmount
                        );

                    }

                );

            } catch (betError) {

                console.error(
                    "BET SAVE FAILED:",
                    betError
                );


                // -----------------------------------------
                // REFUND
                // -----------------------------------------

                await diamondRef.transaction(

                    current => {

                        return (
                            Number(
                                current || 0
                            ) +
                            betAmount
                        );

                    }

                );


                throw betError;

            }


            // =============================================
            // SUCCESS
            // =============================================

            console.log(
                "BET SAVED SUCCESSFULLY"
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
                foodData.key
            );

            console.log(
                "BET:",
                betAmount
            );

            console.log(
                "BALANCE:",
                newBalance
            );

            console.log(
                "================================="
            );


            return res.json({

                success:
                    true,

                uid:
                    uid,

                roundId:
                    round.roundId,

                food:
                    foodData.key,

                amount:
                    betAmount,

                multiplier:
                    foodData.multiplier,

                possibleWin:
                    betAmount *
                    foodData.multiplier,

                diamonds:
                    newBalance

            });

        } catch (error) {

            console.error(
                "================================="
            );

            console.error(
                "BET ERROR"
            );

            console.error(
                error
            );

            console.error(
                "================================="
            );


            return res.status(401).json({

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
// SETTLE WIN
// =====================================================

app.post(
    "/game/settle",
    async (req, res) => {

        try {

            // =============================================
            // VERIFY USER
            // =============================================

            const decodedUser =
                await verifyUser(req);

            const uid =
                decodedUser.uid;


            // =============================================
            // ROUND
            // =============================================

            const roundId =
                req.body.roundId;


            if (!roundId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "roundId required"

                });

            }


            // =============================================
            // GET ROUND
            // =============================================

            const roundRef =
                db.ref(
                    `food_game_global/rounds/${roundId}`
                );


            const roundSnapshot =
                await roundRef.once(
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


            // =============================================
            // WINNER
            // =============================================

            const winnerKey =
                round.winnerKey;


            const winner =
                getFoodByKey(
                    winnerKey
                );


            if (!winner) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Winner not available"

                });

            }


            // =============================================
            // SETTLEMENT REF
            // =============================================

            const settlementRef =
                db.ref(
                    `food_game_global/rounds/${roundId}/settlements/${uid}`
                );


            // =============================================
            // CHECK EXISTING
            // =============================================

            const existingSettlement =
                await settlementRef.once(
                    "value"
                );


            const existing =
                existingSettlement.val();


            if (
                existing &&
                existing.status ===
                "paid"
            ) {

                const diamondsSnapshot =
                    await db.ref(
                        `users/${uid}/diamonds`
                    ).once("value");


                return res.json({

                    success:
                        true,

                    alreadySettled:
                        true,

                    roundId:
                        roundId,

                    food:
                        winner.key,

                    win:
                        Number(
                            existing.win || 0
                        ),

                    diamonds:
                        Number(
                            diamondsSnapshot.val() ||
                            0
                        )

                });

            }


            // =============================================
            // USER BET
            // =============================================

            const betSnapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/bets/${uid}/${winner.key}`
                ).once(
                    "value"
                );


            const winningBet =
                Number(
                    betSnapshot.val() ||
                    0
                );


            console.log(
                "SETTLE"
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
                "WINNER:",
                winner.key
            );

            console.log(
                "WINNING BET:",
                winningBet
            );


            // =============================================
            // NO WIN
            // =============================================

            if (
                winningBet <= 0
            ) {

                await settlementRef.set({

                    status:
                        "paid",

                    win:
                        0,

                    food:
                        winner.key,

                    bet:
                        0,

                    uid:
                        uid,

                    settledAt:
                        admin.database
                            .ServerValue
                            .TIMESTAMP

                });


                return res.json({

                    success:
                        true,

                    roundId:
                        roundId,

                    food:
                        winner.key,

                    win:
                        0,

                    diamonds:
                        null

                });

            }


            // =============================================
            // PAYOUT
            // =============================================

            const payout =
                winningBet *
                winner.multiplier;


            const diamondRef =
                db.ref(
                    `users/${uid}/diamonds`
                );


            // =============================================
            // MARK PROCESSING
            // =============================================

            await settlementRef.set({

                status:
                    "processing",

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

                startedAt:
                    admin.database
                        .ServerValue
                        .TIMESTAMP

            });


            // =============================================
            // ADD DIAMONDS
            // =============================================

            const payoutResult =
                await diamondRef.transaction(

                    current => {

                        const diamonds =
                            Number(
                                current || 0
                            );


                        return (
                            diamonds +
                            payout
                        );

                    }

                );


            if (
                !payoutResult.committed
            ) {

                throw new Error(
                    "Payout transaction failed"
                );

            }


            const newBalance =
                Number(
                    payoutResult
                        .snapshot
                        .val() || 0
                );


            // =============================================
            // TODAY WIN
            // =============================================

            const todayWinRef =
                db.ref(
                    `users/${uid}/food_game_today`
                );


            await todayWinRef.transaction(

                current => {

                    return (
                        Number(
                            current || 0
                        ) +
                        payout
                    );

                }

            );


            // =============================================
            // RESULT
            // =============================================

            const resultRef =
                db.ref(
                    `food_game_global/rounds/${roundId}/results/${uid}`
                );


            await resultRef.set({

                uid:
                    uid,

                food:
                    winner.key,

                bet:
                    winningBet,

                multiplier:
                    winner.multiplier,

                win:
                    payout,

                settledAt:
                    admin.database
                        .ServerValue
                        .TIMESTAMP

            });


            // =============================================
            // SETTLEMENT PAID
            // =============================================

            await settlementRef.update({

                status:
                    "paid",

                diamonds:
                    newBalance,

                paidAt:
                    admin.database
                        .ServerValue
                        .TIMESTAMP

            });


            console.log(
                "PAYOUT SUCCESS"
            );

            console.log(
                "UID:",
                uid
            );

            console.log(
                "WIN:",
                payout
            );

            console.log(
                "BALANCE:",
                newBalance
            );


            // =============================================
            // RESPONSE
            // =============================================

            return res.json({

                success:
                    true,

                alreadySettled:
                    false,

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

                diamonds:
                    newBalance

            });

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
// GET ROUND RESULTS
// =====================================================

app.get(
    "/game/results/:roundId",
    async (req, res) => {

        try {

            const roundId =
                req.params.roundId;


            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );


            const results =
                snapshot.val() ||
                {};


            res.json({

                success:
                    true,

                roundId:
                    roundId,

                results:
                    results

            });

        } catch (error) {

            console.error(
                "RESULTS ERROR:",
                error
            );


            res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get results"

            });

        }

    }
);


// =====================================================
// TOP 3
// =====================================================

app.get(
    "/game/top3/:roundId",
    async (req, res) => {

        try {

            const roundId =
                req.params.roundId;


            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );


            const results =
                snapshot.val() ||
                {};


            const list =
                Object.keys(
                    results
                )
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
                    (
                        a,
                        b
                    ) =>
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


            res.json({

                success:
                    true,

                roundId:
                    roundId,

                top3:
                    list

            });

        } catch (error) {

            console.error(
                "TOP3 ERROR:",
                error
            );


            res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get top3"

            });

        }

    }
);


// =====================================================
// RESULT HISTORY
// =====================================================

app.get(
    "/game/history",
    async (req, res) => {

        try {

            const snapshot =
                await db.ref(
                    "food_game_global/result_history"
                )
                .orderByChild(
                    "createdAt"
                )
                .limitToLast(8)
                .once(
                    "value"
                );


            const data =
                snapshot.val() ||
                {};


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
                        (
                            a,
                            b
                        ) =>
                            Number(
                                b.createdAt || 0
                            ) -
                            Number(
                                a.createdAt || 0
                            )
                    );


            res.json({

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


            res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get history"

            });

        }

    }
);


// =====================================================
// SERVER ERROR
// =====================================================

app.use(
    (
        err,
        req,
        res,
        next
    ) => {

        console.error(
            "EXPRESS ERROR:",
            err
        );


        res.status(500).json({

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
            "VibeCash Food Game Server Started"
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
            "================================="
        );

    }
);
