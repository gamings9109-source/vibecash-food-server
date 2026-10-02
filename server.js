// =====================================================
// VIBECASH FOOD GAME SERVER
// GLOBAL FOOD BETTING GAME
// NODE.JS + EXPRESS + FIREBASE ADMIN
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
// ENVIRONMENT
// =====================================================

const PORT =
    process.env.PORT || 10000;


const FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL;


const FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID;


const FIREBASE_CLIENT_EMAIL =
    process.env.FIREBASE_CLIENT_EMAIL;


const FIREBASE_PRIVATE_KEY =
    process.env.FIREBASE_PRIVATE_KEY;


// =====================================================
// ENVIRONMENT CHECK
// =====================================================

if (!FIREBASE_DATABASE_URL) {

    console.error(
        "FIREBASE_DATABASE_URL is missing"
    );

    process.exit(1);
}


if (!FIREBASE_PROJECT_ID) {

    console.error(
        "FIREBASE_PROJECT_ID is missing"
    );

    process.exit(1);
}


if (!FIREBASE_CLIENT_EMAIL) {

    console.error(
        "FIREBASE_CLIENT_EMAIL is missing"
    );

    process.exit(1);
}


if (!FIREBASE_PRIVATE_KEY) {

    console.error(
        "FIREBASE_PRIVATE_KEY is missing"
    );

    process.exit(1);
}


// =====================================================
// FIREBASE PRIVATE KEY FIX
// =====================================================

const privateKey =
    FIREBASE_PRIVATE_KEY
        .replace(/\\n/g, "\n");


// =====================================================
// FIREBASE ADMIN INITIALIZE
// =====================================================

try {

    admin.initializeApp({

        credential:
            admin.credential.cert({

                projectId:
                    FIREBASE_PROJECT_ID,

                clientEmail:
                    FIREBASE_CLIENT_EMAIL,

                privateKey:
                    privateKey

            }),

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
        FIREBASE_PROJECT_ID
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
        "================================="
    );

    console.error(
        "FIREBASE INITIALIZATION ERROR"
    );

    console.error(
        error.message
    );

    console.error(
        "================================="
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
// TIME
// =====================================================

function now() {

    return Date.now();

}


// =====================================================
// FOOD FIND
// =====================================================

function getFoodByKey(
    key
) {

    return FOODS.find(
        food =>
            food.key === key
    );

}


// =====================================================
// WEIGHTED WINNER
// =====================================================

function chooseWeightedFood() {

    const totalWeight =
        FOODS.reduce(
            (
                total,
                food
            ) =>
                total +
                food.weight,
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
// VERIFY FIREBASE USER
// =====================================================

async function verifyUser(
    req
) {

    const authorization =
        req.headers.authorization;


    if (
        !authorization
    ) {

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


    const idToken =
        authorization.substring(
            7
        );


    if (
        !idToken
    ) {

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
// CREATE NEW ROUND
// =====================================================

async function createNewRound() {

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


    const currentTime =
        now();


    // -------------------------------------------------
    // Existing active round
    // -------------------------------------------------

    if (
        current &&
        current.roundId &&
        Number(
            current.endAt
        ) > currentTime
    ) {

        return current;

    }


    // -------------------------------------------------
    // New round
    // -------------------------------------------------

    const roundId =
        String(
            currentTime
        );


    const startAt =
        currentTime;


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
            admin.database
                .ServerValue
                .TIMESTAMP

    };


    // -------------------------------------------------
    // Save current
    // -------------------------------------------------

    await currentRef.set(
        round
    );


    // -------------------------------------------------
    // Save historical round
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
            admin.database
                .ServerValue
                .TIMESTAMP

    });


    console.log(
        "================================="
    );

    console.log(
        "NEW ROUND CREATED"
    );

    console.log(
        "ROUND:",
        roundId
    );

    console.log(
        "START:",
        startAt
    );

    console.log(
        "BET END:",
        betEndAt
    );

    console.log(
        "SPIN END:",
        spinEndAt
    );

    console.log(
        "END:",
        endAt
    );

    console.log(
        "================================="
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


    const round =
        snapshot.val();


    if (
        !round ||
        !round.roundId
    ) {

        return await createNewRound();

    }


    if (
        Number(
            round.endAt
        ) <= now()
    ) {

        return await createNewRound();

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


    const winner =
        chooseWeightedFood();


    const winnerIndex =
        FOODS.findIndex(
            food =>
                food.key ===
                winner.key
        );


    // -------------------------------------------------
    // Atomic winner selection
    // -------------------------------------------------

    const transactionResult =
        await currentRef.transaction(
            current => {

                if (
                    !current
                ) {

                    return;

                }


                if (
                    current.roundId !==
                    roundId
                ) {

                    return;

                }


                if (
                    Number(
                        current.winnerIndex
                    ) >= 0
                ) {

                    return;

                }


                return {

                    ...current,

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

                };

            }
        );


    if (
        !transactionResult.committed
    ) {

        const snapshot =
            transactionResult.snapshot;


        const current =
            snapshot.val();


        if (
            current &&
            Number(
                current.winnerIndex
            ) >= 0
        ) {

            return getFoodByKey(
                current.winnerKey
            );

        }


        return null;

    }


    // -------------------------------------------------
    // Historical round
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
        "WINNER:",
        winner.key
    );

    console.log(
        "MULTIPLIER:",
        winner.multiplier
    );

    console.log(
        "================================="
    );


    return winner;

}


// =====================================================
// RESULT HISTORY
// =====================================================

async function saveResultHistory(
    round
) {

    if (
        !round ||
        !round.winnerKey
    ) {

        return;

    }


    const winner =
        getFoodByKey(
            round.winnerKey
        );


    if (
        !winner
    ) {

        return;

    }


    const historyRef =
        db.ref(
            "food_game_global/result_history"
        );


    const historyItem = {

        roundId:
            round.roundId,

        food:
            winner.key,

        foodName:
            winner.name,

        multiplier:
            winner.multiplier,

        createdAt:
            admin.database
                .ServerValue
                .TIMESTAMP

    };


    const newRef =
        historyRef.push();


    await newRef.set(
        historyItem
    );


    // -------------------------------------------------
    // Keep latest 8
    // -------------------------------------------------

    const snapshot =
        await historyRef
            .orderByChild(
                "createdAt"
            )
            .once(
                "value"
            );


    const data =
        snapshot.val() ||
        {};


    const keys =
        Object.keys(
            data
        );


    if (
        keys.length > 8
    ) {

        keys.sort(
            (
                a,
                b
            ) =>
                Number(
                    data[a].createdAt || 0
                ) -
                Number(
                    data[b].createdAt || 0
                )
        );


        const removeCount =
            keys.length -
            8;


        const updates = {};


        for (
            let i = 0;
            i < removeCount;
            i++
        ) {

            updates[
                `food_game_global/result_history/${keys[i]}`
            ] =
                null;

        }


        if (
            Object.keys(
                updates
            ).length > 0
        ) {

            await db.ref().update(
                updates
            );

        }

    }

}


// =====================================================
// PROCESS GAME
// =====================================================

let lastHistoryRoundId =
    null;


async function processRound() {

    try {

        const round =
            await getCurrentRound();


        if (
            !round
        ) {

            return;

        }


        const currentTime =
            now();


        // =================================================
        // BETTING
        // =================================================

        if (
            currentTime <
            Number(
                round.betEndAt
            )
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
            Number(
                round.betEndAt
            ) &&
            currentTime <
            Number(
                round.spinEndAt
            )
        ) {

            if (
                Number(
                    round.winnerIndex
                ) < 0
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
            Number(
                round.spinEndAt
            ) &&
            currentTime <
            Number(
                round.endAt
            )
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


                // -----------------------------------------
                // Save history once
                // -----------------------------------------

                if (
                    lastHistoryRoundId !==
                    round.roundId
                ) {

                    await saveResultHistory(
                        round
                    );


                    lastHistoryRoundId =
                        round.roundId;

                }

            }


            return;

        }


        // =================================================
        // ROUND FINISHED
        // =================================================

        if (
            currentTime >=
            Number(
                round.endAt
            )
        ) {

            await createNewRound();

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
                "online",

            time:
                now()

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
                FIREBASE_PROJECT_ID

        });

    }
);


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

            const round =
                await getCurrentRound();


            const currentTime =
                now();


            let phase =
                "betting";


            if (
                currentTime <
                Number(
                    round.betEndAt
                )
            ) {

                phase =
                    "betting";

            }

            else if (
                currentTime <
                Number(
                    round.spinEndAt
                )
            ) {

                phase =
                    "spin";

            }

            else if (
                currentTime <
                Number(
                    round.endAt
                )
            ) {

                phase =
                    "result";

            }

            else {

                phase =
                    "new";

            }


            res.json({

                success:
                    true,

                roundId:
                    round.roundId,

                startAt:
                    Number(
                        round.startAt
                    ),

                betEndAt:
                    Number(
                        round.betEndAt
                    ),

                spinEndAt:
                    Number(
                        round.spinEndAt
                    ),

                endAt:
                    Number(
                        round.endAt
                    ),

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
    async (
        req,
        res
    ) => {

        try {

            // =============================================
            // VERIFY USER
            // =============================================

            const decodedUser =
                await verifyUser(
                    req
                );


            const uid =
                decodedUser.uid;


            // =============================================
            // REQUEST
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
                Number(
                    amount
                );


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
            // FOOD
            // =============================================

            const foodData =
                getFoodByKey(
                    food
                );


            if (
                !foodData
            ) {

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


            if (
                !round
            ) {

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
            // BETTING WINDOW
            // =============================================

            if (
                currentTime <
                Number(
                    round.startAt
                )
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
                Number(
                    round.betEndAt
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Betting closed"

                });

            }


            // =============================================
            // DIAMONDS
            // =============================================

            const diamondRef =
                db.ref(
                    `users/${uid}/diamonds`
                );


            console.log(
                "DIAMOND PATH:",
                `users/${uid}/diamonds`
            );


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


            // =============================================
            // BALANCE
            // =============================================

            if (
                beforeDiamonds <
                betAmount
            ) {

                console.log(
                    "NOT ENOUGH DIAMONDS"
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


            if (
                !diamondResult.committed
            ) {

                const latest =
                    Number(
                        diamondResult
                            .snapshot
                            .val() || 0
                    );


                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Not enough diamonds",

                    serverDiamonds:
                        latest

                });

            }


            const newBalance =
                Number(
                    diamondResult
                        .snapshot
                        .val() || 0
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

            } catch (
                betError
            ) {

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

        } catch (
            error
        ) {

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
// SETTLE WIN
// =====================================================

app.post(
    "/game/settle",
    async (
        req,
        res
    ) => {

        try {

            // =============================================
            // VERIFY USER
            // =============================================

            const decodedUser =
                await verifyUser(
                    req
                );


            const uid =
                decodedUser.uid;


            // =============================================
            // ROUND
            // =============================================

            const roundId =
                req.body.roundId;


            if (
                !roundId
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "roundId required"

                });

            }


            // =============================================
            // ROUND DATA
            // =============================================

            const roundSnapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}`
                ).once(
                    "value"
                );


            const round =
                roundSnapshot.val();


            if (
                !round
            ) {

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

            const winner =
                getFoodByKey(
                    round.winnerKey
                );


            if (
                !winner
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Winner not available"

                });

            }


            // =============================================
            // SETTLEMENT
            // =============================================

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


            // =============================================
            // ALREADY PAID
            // =============================================

            if (
                existing &&
                existing.status ===
                "paid"
            ) {

                const balanceSnapshot =
                    await db.ref(
                        `users/${uid}/diamonds`
                    ).once(
                        "value"
                    );


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
                            balanceSnapshot.val() ||
                            0
                        )

                });

            }


            // =============================================
            // PROCESSING
            // =============================================

            if (
                existing &&
                existing.status ===
                "processing"
            ) {

                return res.json({

                    success:
                        true,

                    processing:
                        true,

                    roundId:
                        roundId,

                    food:
                        winner.key,

                    win:
                        Number(
                            existing.win || 0
                        )

                });

            }


            // =============================================
            // USER WINNING BET
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
                "================================="
            );

            console.log(
                "SETTLE REQUEST"
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

                    bet:
                        0,

                    multiplier:
                        winner.multiplier,

                    win:
                        0

                });

            }


            // =============================================
            // PAYOUT
            // =============================================

            const payout =
                winningBet *
                winner.multiplier;


            // =============================================
            // LOCK SETTLEMENT
            // =============================================

            const lockResult =
                await settlementRef.transaction(

                    current => {

                        if (
                            current
                        ) {

                            return;

                        }


                        return {

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

                        };

                    }

                );


            if (
                !lockResult.committed
            ) {

                const lockSnapshot =
                    lockResult.snapshot;


                const lockData =
                    lockSnapshot.val();


                if (
                    lockData &&
                    lockData.status ===
                    "paid"
                ) {

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
                                lockData.win || 0
                            )

                    });

                }


                return res.json({

                    success:
                        true,

                    processing:
                        true,

                    roundId:
                        roundId,

                    food:
                        winner.key,

                    win:
                        payout

                });

            }


            // =============================================
            // PAY DIAMONDS
            // =============================================

            const diamondRef =
                db.ref(
                    `users/${uid}/diamonds`
                );


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
                        .val() ||
                    0
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

            await db.ref(
                `food_game_global/rounds/${roundId}/results/${uid}`
            ).set({

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
            // UPDATE SETTLEMENT
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

            console.log(
                "================================="
            );


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

        } catch (
            error
        ) {

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
// ROUND RESULTS
// =====================================================

app.get(
    "/game/results/:roundId",
    async (
        req,
        res
    ) => {

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


            return res.json({

                success:
                    true,

                roundId:
                    roundId,

                results:
                    results

            });

        } catch (
            error
        ) {

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


            const top3 =
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


            return res.json({

                success:
                    true,

                roundId:
                    roundId,

                top3:
                    top3

            });

        } catch (
            error
        ) {

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
                snapshot.val() ||
                {};


            const history =
                Object.keys(
                    data
                )
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

        } catch (
            error
        ) {

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
// 404
// =====================================================

app.use(
    (
        req,
        res
    ) => {

        res.status(404).json({

            success:
                false,

            error:
                "Endpoint not found"

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
            "VIBECASH FOOD GAME SERVER STARTED"
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
            "================================="
        );

    }
);
