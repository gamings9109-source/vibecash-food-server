// =====================================================
// VIBECASH FOOD GAME SERVER
// RENDER + NODE.JS + EXPRESS + FIREBASE ADMIN
// =====================================================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());

app.use(
    express.json({
        limit: "1mb"
    })
);


// =====================================================
// ENV
// =====================================================

const PORT =
    process.env.PORT || 10000;

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

} catch (e) {

    console.error(
        "Invalid FIREBASE_SERVICE_ACCOUNT JSON"
    );

    console.error(
        e.message
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

admin.initializeApp({

    credential:
        admin.credential.cert(
            serviceAccount
        ),

    databaseURL:
        FIREBASE_DATABASE_URL

});


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
// FOODS
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

    let totalWeight = 0;

    for (
        const food of FOODS
    ) {

        totalWeight +=
            food.weight;

    }


    let roll =
        Math.random() *
        totalWeight;


    for (
        const food of FOODS
    ) {

        roll -=
            food.weight;

        if (
            roll <= 0
        ) {

            return food;

        }

    }


    return FOODS[0];

}


// =====================================================
// VERIFY LOGIN TOKEN
// =====================================================

async function verifyUser(
    req
) {

    const header =
        req.headers.authorization;


    if (
        !header
    ) {

        throw new Error(
            "Authorization token missing"
        );

    }


    if (
        !header.startsWith(
            "Bearer "
        )
    ) {

        throw new Error(
            "Invalid authorization header"
        );

    }


    const token =
        header.substring(
            7
        );


    if (
        !token
    ) {

        throw new Error(
            "Authorization token missing"
        );

    }


    return await admin
        .auth()
        .verifyIdToken(
            token
        );

}


// =====================================================
// CREATE ROUND
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


    if (
        current &&
        current.roundId &&
        Number(
            current.endAt
        ) > currentTime
    ) {

        return current;

    }


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


    const updates = {};


    updates[
        "food_game_global/current"
    ] =
        round;


    updates[
        `food_game_global/rounds/${roundId}`
    ] =
        round;


    await db
        .ref()
        .update(
            updates
        );


    console.log(
        "NEW ROUND:",
        roundId
    );


    return round;

}


// =====================================================
// GET CURRENT ROUND
// =====================================================

async function getCurrentRound() {

    const snapshot =
        await db.ref(
            "food_game_global/current"
        ).once(
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

                    return current;

                }


                current.phase =
                    "spin";


                current.winnerIndex =
                    winner.index;


                current.winnerKey =
                    winner.key;


                current.winnerName =
                    winner.name;


                current.winnerMultiplier =
                    winner.multiplier;


                return current;

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


    await db
        .ref(
            `food_game_global/rounds/${roundId}`
        )
        .update({

            phase:
                "spin",

            winnerIndex:
                winner.index,

            winnerKey:
                winner.key,

            winnerName:
                winner.name,

            winnerMultiplier:
                winner.multiplier

        });


    console.log(
        "WINNER:",
        winner.name,
        "x",
        winner.multiplier,
        "ROUND:",
        roundId
    );


    return winner;

}


// =====================================================
// UPDATE PHASE
// =====================================================

async function updateRoundPhase(
    round
) {

    if (
        !round
    ) {

        return;

    }


    const currentTime =
        now();


    let phase =
        round.phase;


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


    if (
        phase !==
        round.phase
    ) {

        await db
            .ref(
                "food_game_global/current"
            )
            .update({

                phase:
                    phase

            });


        await db
            .ref(
                `food_game_global/rounds/${round.roundId}`
            )
            .update({

                phase:
                    phase

            });

    }

}


// =====================================================
// RESULT HISTORY
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


    const ref =
        db.ref(
            `food_game_global/result_history/${round.roundId}`
        );


    const exists =
        await ref.once(
            "value"
        );


    if (
        exists.exists()
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
            admin.database
                .ServerValue
                .TIMESTAMP

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


            const currentTime =
                now();


            // ---------------------------------------------
            // WINNER SELECT
            // ---------------------------------------------

            if (
                currentTime >=
                Number(
                    round.betEndAt
                ) &&
                Number(
                    round.winnerIndex
                ) < 0
            ) {

                const winner =
                    await chooseWinner(
                        round.roundId
                    );


                if (
                    winner
                ) {

                    round =
                        await getCurrentRound();

                }

            }


            // ---------------------------------------------
            // PHASE
            // ---------------------------------------------

            await updateRoundPhase(
                round
            );


            // ---------------------------------------------
            // REFRESH
            // ---------------------------------------------

            round =
                await getCurrentRound();


            // ---------------------------------------------
            // SAVE HISTORY
            // ---------------------------------------------

            if (
                Number(
                    round.winnerIndex
                ) >= 0 &&
                currentTime >=
                    Number(
                        round.spinEndAt
                    )
            ) {

                await saveResultHistory(
                    round
                );

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

                phase:
                    round.phase,

                winnerIndex:
                    Number(
                        round.winnerIndex
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
                    ),

                serverTime:
                    currentTime

            });


        } catch (
            error
        ) {

            console.error(
                "STATE ERROR:",
                error
            );


            res.status(
                500
            ).json({

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

            // ---------------------------------------------
            // AUTH
            // ---------------------------------------------

            const decoded =
                await verifyUser(
                    req
                );


            const uid =
                decoded.uid;


            // ---------------------------------------------
            // INPUT
            // ---------------------------------------------

            const amount =
                Number(
                    req.body.amount
                );


            const foodKey =
                String(
                    req.body.foodKey ||
                    ""
                ).toLowerCase();


            // ---------------------------------------------
            // VALIDATION
            // ---------------------------------------------

            if (
                !Number.isInteger(
                    amount
                ) ||
                amount <= 0
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Invalid bet amount"

                });

            }


            const food =
                getFoodByKey(
                    foodKey
                );


            if (
                !food
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Invalid food"

                });

            }


            // ---------------------------------------------
            // ROUND
            // ---------------------------------------------

            const round =
                await getCurrentRound();


            const currentTime =
                now();


            if (
                currentTime <
                Number(
                    round.startAt
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Round has not started"

                });

            }


            if (
                currentTime >=
                Number(
                    round.betEndAt
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Betting closed",

                    roundId:
                        round.roundId

                });

            }


            // ---------------------------------------------
            // DIAMOND PATH
            // ---------------------------------------------

            const diamondRef =
                db.ref(
                    `users/${uid}/diamonds`
                );


            // ---------------------------------------------
            // ATOMIC DEDUCTION
            // ---------------------------------------------

            const transaction =
                await diamondRef.transaction(

                    currentDiamonds => {

                        const diamonds =
                            Number(
                                currentDiamonds || 0
                            );


                        if (
                            diamonds <
                            amount
                        ) {

                            return;

                        }


                        return (
                            diamonds -
                            amount
                        );

                    }

                );


            if (
                !transaction.committed
            ) {

                const snapshot =
                    await diamondRef.once(
                        "value"
                    );


                const serverDiamonds =
                    Number(
                        snapshot.val() || 0
                    );


                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Not enough diamonds",

                    serverDiamonds:
                        serverDiamonds,

                    uid:
                        uid

                });

            }


            const newBalance =
                Number(
                    transaction.snapshot.val() || 0
                );


            // ---------------------------------------------
            // SAVE BET
            // ---------------------------------------------

            const betRef =
                db.ref(
                    `food_game_global/rounds/${round.roundId}/bets/${uid}/${food.key}`
                );


            try {

                await betRef.transaction(

                    currentAmount => {

                        return (
                            Number(
                                currentAmount || 0
                            ) +
                            amount
                        );

                    }

                );

            } catch (
                betError
            ) {

                // -----------------------------------------
                // REFUND IF BET SAVE FAILS
                // -----------------------------------------

                await diamondRef.transaction(

                    currentDiamonds => {

                        return (
                            Number(
                                currentDiamonds || 0
                            ) +
                            amount
                        );

                    }

                );


                throw betError;

            }


            console.log(
                "BET",
                uid,
                food.key,
                amount,
                "BALANCE",
                newBalance
            );


            res.json({

                success:
                    true,

                roundId:
                    round.roundId,

                foodKey:
                    food.key,

                foodName:
                    food.name,

                amount:
                    amount,

                multiplier:
                    food.multiplier,

                possibleWin:
                    amount *
                    food.multiplier,

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


            res.status(
                500
            ).json({

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

            // ---------------------------------------------
            // AUTH
            // ---------------------------------------------

            const decoded =
                await verifyUser(
                    req
                );


            const uid =
                decoded.uid;


            const roundId =
                String(
                    req.body.roundId ||
                    ""
                );


            if (
                !roundId
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Round ID missing"

                });

            }


            // ---------------------------------------------
            // ROUND
            // ---------------------------------------------

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

                return res.status(
                    404
                ).json({

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

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Winner not selected"

                });

            }


            // ---------------------------------------------
            // SETTLEMENT MARKER
            // ---------------------------------------------

            const settlementRef =
                db.ref(
                    `food_game_global/rounds/${roundId}/settlements/${uid}`
                );


            const settlementSnapshot =
                await settlementRef.once(
                    "value"
                );


            // ---------------------------------------------
            // ALREADY PAID
            // ---------------------------------------------

            if (
                settlementSnapshot.exists() &&
                settlementSnapshot
                    .child("status")
                    .val() ===
                    "paid"
            ) {

                const oldPayout =
                    Number(
                        settlementSnapshot
                            .child("win")
                            .val() ||
                        settlementSnapshot
                            .child("payout")
                            .val() ||
                        0
                    );


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

                    multiplier:
                        winner.multiplier,

                    win:
                        oldPayout,

                    payout:
                        oldPayout,

                    diamonds:
                        Number(
                            balanceSnapshot.val() ||
                            0
                        )

                });

            }


            // ---------------------------------------------
            // MY BET
            // ---------------------------------------------

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


            // ---------------------------------------------
            // NO WIN
            // ---------------------------------------------

            if (
                winningBet <= 0
            ) {

                await settlementRef.set({

                    status:
                        "settled",

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
                        0,

                    payout:
                        0,

                    diamonds:
                        Number(
                            balanceSnapshot.val() ||
                            0
                        )

                });

            }


            // ---------------------------------------------
            // PAYOUT
            // ---------------------------------------------

            const payout =
                winningBet *
                winner.multiplier;


            const diamondRef =
                db.ref(
                    `users/${uid}/diamonds`
                );


            // ---------------------------------------------
            // ATOMIC PAYOUT
            // ---------------------------------------------

            const payoutTransaction =
                await diamondRef.transaction(

                    currentDiamonds => {

                        return (
                            Number(
                                currentDiamonds || 0
                            ) +
                            payout
                        );

                    }

                );


            if (
                !payoutTransaction.committed
            ) {

                throw new Error(
                    "Payout transaction failed"
                );

            }


            const newBalance =
                Number(
                    payoutTransaction
                        .snapshot
                        .val() ||
                    0
                );


            // ---------------------------------------------
            // TODAY WIN
            // ---------------------------------------------

            const today =
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


            const todayRef =
                db.ref(
                    `users/${uid}/food_game_today`
                );


            await todayRef.transaction(

                current => {

                    current =
                        current || {};


                    const oldDate =
                        String(
                            current.date ||
                            ""
                        );


                    let oldWin =
                        Number(
                            current.win ||
                            0
                        );


                    if (
                        oldDate !==
                        today
                    ) {

                        oldWin =
                            0;

                    }


                    current.date =
                        today;


                    current.win =
                        oldWin +
                        payout;


                    return current;

                }

            );


            // ---------------------------------------------
            // GET PROFILE
            // ---------------------------------------------

            const userSnapshot =
                await db.ref(
                    `users/${uid}`
                ).once(
                    "value"
                );


            const user =
                userSnapshot.val() ||
                {};


            const userName =
                user.name ||
                user.user_name ||
                user.username ||
                "User";


            const profileImage =
                user.profile_pic ||
                user.profile_image ||
                user.profileImage ||
                "";


            // ---------------------------------------------
            // SAVE ROUND RESULT
            // ---------------------------------------------

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

                round:
                    roundId,

                time:
                    admin.database
                        .ServerValue
                        .TIMESTAMP

            });


            // ---------------------------------------------
            // SAVE SETTLEMENT
            // ---------------------------------------------

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

                paidAt:
                    admin.database
                        .ServerValue
                        .TIMESTAMP

            });


            // ---------------------------------------------
            // LEADERBOARD
            // ---------------------------------------------

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
                            current.total_win ||
                            0
                        );


                    current.uid =
                        uid;

                    current.name =
                        userName;

                    current.profile_image =
                        profileImage;

                    current.total_win =
                        oldTotal +
                        payout;

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


            console.log(
                "SETTLEMENT",
                uid,
                "ROUND",
                roundId,
                "BET",
                winningBet,
                "WIN",
                payout,
                "BALANCE",
                newBalance
            );


            // ---------------------------------------------
            // RESPONSE
            // ---------------------------------------------

            res.json({

                success:
                    true,

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


            res.status(
                500
            ).json({

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
                req.params.roundId;


            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );


            const data =
                snapshot.val() ||
                {};


            const top3 =
                Object.keys(
                    data
                )
                .map(
                    uid => ({
                        uid:
                            uid,

                        ...data[uid]
                    })
                )
                .filter(
                    item =>
                        Number(
                            item.win ||
                            0
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


            res.json({

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


            res.status(
                500
            ).json({

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
                req.params.roundId;


            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );


            res.json({

                success:
                    true,

                roundId:
                    roundId,

                results:
                    snapshot.val() ||
                    {}

            });


        } catch (
            error
        ) {

            console.error(
                "RESULTS ERROR:",
                error
            );


            res.status(
                500
            ).json({

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
                snapshot.val() ||
                {};


            const history =
                Object.keys(
                    data
                )
                .map(
                    id => ({

                        id:
                            id,

                        ...data[id]

                    })
                )
                .sort(
                    (a, b) =>
                        Number(
                            b.createdAt ||
                            0
                        ) -
                        Number(
                            a.createdAt ||
                            0
                        )
                )
                .slice(
                    0,
                    8
                );


            res.json({

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


            res.status(
                500
            ).json({

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

                        index:
                            food.index,

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
// HEALTH
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
                "online"

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

        res.status(
            404
        ).json({

            success:
                false,

            error:
                "Endpoint not found"

        });

    }
);


// =====================================================
// ERROR
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


        res.status(
            500
        ).json({

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
            "sec"
        );

        console.log(
            "SPIN:",
            SPIN_DURATION / 1000,
            "sec"
        );

        console.log(
            "RESULT:",
            SHOW_DURATION / 1000,
            "sec"
        );

        console.log(
            "================================="
        );

    }
);
