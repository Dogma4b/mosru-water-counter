let nodeFetch = require('node-fetch'),
tough = require('tough-cookie');

class Mos {

    #cookieJar = new tough.CookieJar();
    http = require('fetch-cookie/node-fetch')(nodeFetch, this.#cookieJar);
    cstore = this.#cookieJar.store;

    #login;
    #password;

    #Authorized = false;
    #logoutTimer;
    
    #WaterObj = {};

    constructor(login,password) {
        this.#login = login;
        this.#password = password;
    }

    async Auth(login=this.#login, password=this.#password) {
        if (this.#Authorized) return true;

        await this.http('https://www.mos.ru/api/acs/v1/login');
        //await fetch('https://login.mos.ru/7ccd851171c');
    
        //let csrf = cookieJar.store.idx['login.mos.ru']['/']['csrf-token-value'].toJSON().value;
        
        await this.http('https://login.mos.ru/sps/login/methods/password', {
            method:'POST',
            body:`login=${login}&password=${password}`,
            headers: {"content-type": "application/x-www-form-urlencoded"}
        });

        try {
            if(this.cstore.idx['mos.ru']['/']['Ltpatoken2']) {
                this.#Authorized = true;
                this.#logoutTimer = setTimeout(() => this.Logout(), 7200000);
                return {code:1,info:"Authorization successful"};
            }
        } catch(err) {
            return {code:3,info:"Bad login/password"};
        }
    }

    async Logout() {
        if (!this.#Authorized) return false;

        await this.#cookieJar.removeAllCookies();

        this.#Authorized = false;
        clearTimeout(this.#logoutTimer);

        return true;
    }

    async Water(payCode, flat) {
        if (!this.#Authorized) {
            let authState = await this.Auth();
            if (authState.code == 3) return authState;
        }

        if (typeof this.#WaterObj[`${payCode}-${flat}`] != 'undefined') {
            return this.#WaterObj[`${payCode}-${flat}`];
        } else {
            this.#WaterObj[`${payCode}-${flat}`] = new Water(payCode,flat,this.http);
            return await this.#WaterObj[`${payCode}-${flat}`].getCountersData();
            //return this.#WaterObj[`${payCode}-${flat}`];
        }
    }

}

class Water {

    #http;

    #payCode;
    #flat;
    
    Cold;
    Hot;
    
    constructor(payCode,flat,http) {
        this.#http = http;
        this.#payCode = payCode;
        this.#flat = flat;
        
        this.Cold = new Counter(payCode,flat,http,(async () => await this.getCountersData()));
        this.Hot = new Counter(payCode,flat,http,(async () => await this.getCountersData()));
        
        //this.#getCountersData(payCode,flat);
    }
    
    async getCountersData(payCode=this.#payCode,flat=this.#flat) {
        let res = await this.#http('https://www.mos.ru/pgu/common/ajax/index.php', {
            method:'POST',
            body:`ajaxModule=Guis&ajaxAction=getCountersInfo&items[paycode]=${payCode}&items[flat]=${flat}`,
            headers: {"content-type": "application/x-www-form-urlencoded"}})
        try {
            let json = await res.json();
            for (const counter of json.counter) {
                this[counter.type == 1 ? 'Cold' : 'Hot'].id = counter.counterId;
                this[counter.type == 1 ? 'Cold' : 'Hot'].name = counter.num;
                this[counter.type == 1 ? 'Cold' : 'Hot'].indications = counter.indications;
                this[counter.type == 1 ? 'Cold' : 'Hot'].checkup = counter.checkup;
            }

            return this;
        } catch(err) {
            return {code:4,info:"Bad Paycode/Flat"};
        }
    }

    get(type) {
        
    }
}

class Counter {

    #http;
    #updateCounters;

    id = 0;
    name = '';
    indications = [];
    checkup = '';

    constructor(payCode,flat,http,updateCounters) {
        this.payCode = payCode;
        this.flat = flat;
        this.#http = http;
        this.#updateCounters = updateCounters;
    }

    get latestIndication() {
        return this.indications[0].indication;
    }

    async pushIndication(val,month=new Date().getMonth()+1) {

        let code;
        let date = new Date(new Date(Date.now()).setMonth(month - 1));
        date = date.toJSON().split('T')[0]; //`${date.getFullYear()}-0${date.getMonth().l + 1}-31`; //${date.getDate()}`;

        await this.#http('https://www.mos.ru/pgu/common/ajax/index.php', {
            method:'POST',
            body:`ajaxModule=Guis&ajaxAction=addCounterInfo&items%5Bpaycode%5D=${this.payCode}&items%5Bflat%5D=${this.flat}&items[indications][0][counterNum]=${this.id}&items[indications][0][counterVal]=${val}&items[indications][0][num]=${this.name}&items[indications][0][period]=${date}`,
            headers: {"content-type": "application/x-www-form-urlencoded"}})
        .then(res => res.json())
        .then(json => code = json.code);

        await this.#updateCounters();

        switch(parseInt(code)) {
            case 0:
                return {code:0,info:'Indication sended'};
                break;
            case 5:
                return {code:5,info:'Too low indication value'};
                break;
            case 6:
                return {code:6,info:'Indication already entered'};
                break;
            case 7:
                return {code:7,info:'Too high indication value'};
                break;
            case 99:
                return {code:99,info:'Invalid date or technical problem'};
                break;
        }
    }
    
    async delLastIndication() {
        let code;

        await this.#http('https://www.mos.ru/pgu/common/ajax/index.php', {
            method:'POST',
            body:`ajaxModule=Guis&ajaxAction=removeCounterIndication&items[paycode]=${this.payCode}&items[flat]=${this.flat}&items[counterId]=${this.id}`,
            headers: {"content-type": "application/x-www-form-urlencoded"}})
        .then(res => res.json())
        .then(json => code = json.code);

        await this.#updateCounters();

        switch(parseInt(code)) {
            case 0:
                return {code:0,info:'Delete indication successed'};
                break;
            case 5:
                return {code:5,info:'The removed reading is accepted for calculation'};
                break;
        }
    }
}

module.exports = Mos;