setInterval(async () => {
    gameState.timer--;

    if (gameState.timer <= 0) {
        let greenTotal = 0;
        let redTotal = 0;

        // Calculate total bet amounts for each color
        gameState.activeBets.forEach(bet => {
            if (bet.color.toLowerCase() === 'green') greenTotal += bet.amount;
            if (bet.color.toLowerCase() === 'red') redTotal += bet.amount;
        });

        let resultColor = 'Green';

        // STRICT OPPOSITE LOGIC
        if (greenTotal > redTotal) {
            resultColor = 'Red'; // Green vadhu chhe to Red aavshe
        } else if (redTotal > greenTotal) {
            resultColor = 'Green'; // Red vadhu chhe to Green aavshe
        } else if (gameState.activeBets.length > 0) {
            // Jo 1 j bet hoy ke amounts equal hoy
            const firstBetColor = gameState.activeBets[0].color.toLowerCase();
            resultColor = firstBetColor === 'green' ? 'Red' : 'Green';
        } else {
            // Bet na lagi hoy to Random
            resultColor = Math.random() > 0.5 ? 'Green' : 'Red';
        }

        gameState.lastResult = resultColor;

        await GameHistory.create({
            periodId: gameState.periodId,
            color: resultColor
        });

        // Credit 1.9x to winners (Aama single player hase to e hamesha harse)
        for (const bet of gameState.activeBets) {
            if (bet.color.toLowerCase() === resultColor.toLowerCase()) {
                const winAmount = bet.amount * 1.9;
                await User.findOneAndUpdate(
                    { account: bet.userId },
                    { $inc: { balance: winAmount } }
                );
            }
        }

        // Reset Round State
        gameState.activeBets = [];
        gameState.timer = 60;
        gameState.periodId = Date.now().toString().slice(-8);
    }
}, 1000);
