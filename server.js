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

const FIREBASE_SERVICE_ACCOUNT =
    process.env.FIREBASE_SERVICE_ACCOUNT;


// =====================================================
// ENVIRONMENT CHECK
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
// PARSE SERVICE ACCOUNT
// =====================================================

let serviceAccount;

try {

    serviceAccount =
        JSON.parse(
            FIREBASE_SERVICE_ACCOUNT
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
// SERVICE ACCOUNT VALIDATION
// =====================================================

if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
) {

    console.error(
        "================================="
    );

    console.error(
        "INVALID FIREBASE SERVICE ACCOUNT"
    );

    console.error(
        "Required:"
    );

    console.error(
        "project_id"
    );

    console.error(
        "client_email"
    );

    console.error(
        "private_key"
    );

    console.error(
        "================================="
    );

    process.exit(1);
}


// =====================================================
// PRIVATE KEY FIX
// =====================================================

serviceAccount.private_key =
    String(
        serviceAccount.private_key
    )
    .replace(/\\n/g, "\n")
    .trim();


// =====================================================
// FIREBASE ADMIN INITIALIZE
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
        "FIREBASE ADMIN CONNECTED"
    );

    console.log(
        "Project:",
        serviceAccount.project_id
    );

    console.log(
        "Client:",
        serviceAccount.client_email
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

function getFoodByKey(key) {

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

async function verifyUser(req) {

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
        authorization.substring(7);


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


    const snapshot =
        await currentRef.once(
            "value"
        );


    const current =
        snapshot.val();


    const currentTime =
        now();


    // -------------------------------------------------
    // ACTIVE ROUND
    // -------------------------------------------------

    if (
        current &&
        current.roundId &&
        Number(current.endAt) >
            currentTime
    ) {

        return current;

    }


    // -------------------------------------------------
    // NEW ROUND
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
    // SAVE CURRENT + HISTORY METADATA
    // -------------------------------------------------

    const updates = {};


    updates[
        "food_game_global/current"
    ] = round;


    updates[
        `food_game_global/rounds/${roundId}`
    ] = {

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


    await db.ref().update(
        updates
    );


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

async function chooseWinner(
    roundId
) {

    const currentRef =
        db.ref(
            "food_game_global/current"
        );


    const randomWinner =
        chooseWeightedFood();


    const winnerIndex =
        FOODS.findIndex(
            food =>
                food.key ===
                randomWinner.key
        );


    // -------------------------------------------------
    // TRANSACTION
    // -------------------------------------------------

    const result =
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
                        randomWinner.key,

                    winnerName:
                        randomWinner.name,

                    winnerMultiplier:
                        randomWinner.multiplier

                };

            }

        );


    if (
        !result.committed
    ) {

        const existing =
            result.snapshot.val();


        if (
            existing &&
            Number(
                existing.winnerIndex
            ) >= 0
        ) {

            return getFoodByKey(
                existing.winnerKey
            );

        }


        return null;

    }


    // -------------------------------------------------
    // SAVE HISTORICAL WINNER
    // -------------------------------------------------

    await db.ref(
        `food_game_global/rounds/${roundId}`
    ).update({

        phase:
            "spin",

        winnerIndex:
            winnerIndex,

        winnerKey:
            randomWinner.key,

        winnerName:
            randomWinner.name,

        winnerMultiplier:
            randomWinner.multiplier

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
        randomWinner.key
    );

    console.log(
        "MULTIPLIER:",
        randomWinner.multiplier
    );

    console.log(
        "================================="
    );


    return randomWinner;

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


    if (
        !winner
    ) {

        return;

    }


    // -------------------------------------------------
    // USE ROUND ID AS KEY
    // Prevent duplicate history after restart
    // -------------------------------------------------

    const historyRef =
        db.ref(
            `food_game_global/result_history/${round.roundId}`
        );


    const existing =
        await historyRef.once(
            "value"
        );


    if (
        existing.exists()
    ) {

        return;

    }


    await historyRef.set({

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

    });


    // -------------------------------------------------
    // KEEP LAST 8
    // -------------------------------------------------

    const allSnapshot =
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
        allSnapshot.val() ||
        {};


    const keys =
        Object.keys(
            data
        );


    if (
        keys.length <= 8
    ) {

        return;

    }


    keys.sort(
        (
            a,
            b
        ) => {

            return (
                Number(
                    data[a].createdAt || 0
                ) -
                Number(
                    data[b].createdAt || 0
                )
            );

        }
    );


    const removeCount =
        keys.length - 8;


    const updates = {};


    for (
        let i = 0;
        i < removeCount;
        i++
    ) {

        updates[
            `food_game_global/result_history/${keys[i]}`
        ] = null;

    }


    await db.ref().update(
        updates
    );

}


// =====================================================
// PROCESS ROUND
// =====================================================

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

                const winnerIndex =
                    FOODS.findIndex(
                        food =>
                            food.key ===
                            winner.key
                    );


                await db.ref(
                    "food_game_global/current"
                ).update({

                    phase:
                        "result",

                    winnerIndex:
                        winnerIndex,

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


                await saveResultHistory(
                    round
                );

            }


            return;

        }


        // =================================================
        // NEW ROUND
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
    (
        req,
        res
    ) => {

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
    (
        req,
        res
    ) => {

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


            // =============================================
            // BETTING CHECK
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


            const beforeSnapshot =
                await diamondRef.once(
                    "value"
                );


            const beforeDiamonds =
                Number(
                    beforeSnapshot.val() ||
                    0
                );


            console.log(
                "DIAMONDS BEFORE:",
                beforeDiamonds
            );


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

            const deduction =
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
                !deduction.committed
            ) {

                const latest =
                    Number(
                        deduction
                            .snapshot
                            .val() ||
                        0
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
                    deduction
                        .snapshot
                        .val() ||
                    0
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

            } catch (error) {

                console.error(
                    "BET SAVE FAILED:",
                    error
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


                throw error;

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
            // ROUND ID
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
            // ROUND
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
            // SETTLEMENT REF
            // =============================================

            const settlementRef =
                db.ref(
                    `food_game_global/rounds/${roundId}/settlements/${uid}`
                );


            const settlementSnapshot =
                await settlementRef.once(
                    "value"
                );


            const existing =
                settlementSnapshot.val();


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

                    bet:
                        Number(
                            existing.bet || 0
                        ),

                    multiplier:
                        Number(
                            existing.multiplier ||
                            winner.multiplier
                        ),

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
            // EXISTING PROCESSING
            // =============================================
            //
            // If processing exists, first check result.
            // If result exists, settlement can safely be
            // completed without paying again.
            //
            // =============================================

            if (
                existing &&
                existing.status ===
                "processing"
            ) {

                const resultSnapshot =
                    await db.ref(
                        `food_game_global/rounds/${roundId}/results/${uid}`
                    ).once(
                        "value"
                    );


                const previousResult =
                    resultSnapshot.val();


                if (
                    previousResult
                ) {

                    await settlementRef.update({

                        status:
                            "paid",

                        paidAt:
                            admin.database
                                .ServerValue
                                .TIMESTAMP

                    });


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

                        bet:
                            Number(
                                previousResult.bet ||
                                0
                            ),

                        multiplier:
                            Number(
                                previousResult.multiplier ||
                                winner.multiplier
                            ),

                        win:
                            Number(
                                previousResult.win ||
                                0
                            ),

                        diamonds:
                            Number(
                                balanceSnapshot.val() ||
                                0
                            )

                    });

                }

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

                    alreadySettled:
                        false,

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
            // SETTLEMENT LOCK
            // =============================================

            const lock =
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
                !lock.committed
            ) {

                const lockData =
                    lock.snapshot.val();


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

                        bet:
                            Number(
                                lockData.bet || 0
                            ),

                        multiplier:
                            Number(
                                lockData.multiplier ||
                                winner.multiplier
                            ),

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
            // ATOMIC PAYOUT
            // =============================================
            //
            // Diamond + today win + result +
            // settlement paid are written together.
            //
            // This prevents:
            // - payout without result
            // - result without payout
            // - duplicate payout after retry
            //
            // =============================================

            const diamondPath =
                `users/${uid}/diamonds`;

            const todayWinPath =
                `users/${uid}/food_game_today`;

            const resultPath =
                `food_game_global/rounds/${roundId}/results/${uid}`;

            const settlementPath =
                `food_game_global/rounds/${roundId}/settlements/${uid}`;


            const atomicUpdates = {};


            atomicUpdates[
                diamondPath
            ] =
                admin.database
                    .ServerValue
                    .increment(
                        payout
                    );


            atomicUpdates[
                todayWinPath
            ] =
                admin.database
                    .ServerValue
                    .increment(
                        payout
                    );


            atomicUpdates[
                resultPath
            ] = {

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

            };


            atomicUpdates[
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

                bet:
                    winningBet,

                multiplier:
                    winner.multiplier,

                win:
                    payout,

                paidAt:
                    admin.database
                        .ServerValue
                        .TIMESTAMP

            };


            await db.ref().update(
                atomicUpdates
            );


            // =============================================
            // NEW BALANCE
            // =============================================

            const balanceSnapshot =
                await db.ref(
                    diamondPath
                ).once(
                    "value"
                );


            const newBalance =
                Number(
                    balanceSnapshot.val() ||
                    0
                );


            // =============================================
            // SUCCESS
            // =============================================

            console.log(
                "================================="
            );

            console.log(
                "PAYOUT SUCCESS"
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
                winner.key
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

        } catch (error) {

            console.error(
                "================================="
            );

            console.error(
                "SETTLE ERROR"
            );

            console.error(
                error
            );

            console.error(
                "================================="
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
                    ) => {

                        return (
                            Number(
                                b.win || 0
                            ) -
                            Number(
                                a.win || 0
                            )
                        );

                    }
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
                    ) => {

                        return (
                            Number(
                                b.createdAt || 0
                            ) -
                            Number(
                                a.createdAt || 0
                            )
                        );

                    }
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
// GAME CONFIG
// =====================================================

app.get(
    "/game/config",
    (
        req,
        res
    ) => {

        res.json({

            success:
                true,

            betDuration:
                BET_DURATION,

            spinDuration:
                SPIN_DURATION,

            showDuration:
                SHOW_DURATION,

            foods:
                FOODS.map(
                    food => ({

                        key:
                            food.key,

                        name:
                            food.name,

                        multiplier:
                            food.multiplier

                    })
                )

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
