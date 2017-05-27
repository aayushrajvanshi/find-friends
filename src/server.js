import express from 'express';
const app = express();
import bodyParser from 'body-parser';
import morgan from 'morgan';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import config from './config';
import gcm from 'node-gcm';
import cors from 'cors';

app.use(cors());

var User = require('./app/models/user');
var Mapping = require('./app/models/mapping');
var Location = require('./app/models/location');

const sender = new gcm.Sender(config.server_key);

const port = process.env.PORT || 8080;
const isProd = process.env.NODE_ENV === 'production';

mongoose.Promise = global.Promise;
mongoose.connect(isProd ? config.database_prod : config.database_dev, (err) => {
    if (err) console.error(err);
});
app.set('superSecret', config.secret);

app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(bodyParser.json());

app.use(morgan('dev'));

var apiRoutes = express.Router();

app.get('/', (req, res) => {
    res.send('API Available');
});

apiRoutes.post('/login', (req, res) => {
    User.findOne({
            email_id: req.body.email_id
        })
        .exec()
        .then((user) => {
            user.access_token = '';
            let token = jwt.sign(user.email_id, app.get('superSecret'));
            User.update({
                    email_id: user.email_id
                }, {
                    gcm_key: req.body.gcm_key,
                    access_token: token
                }, {
                    upsert: true
                }).exec()
                .then(() => {
                    res.json({
                        success: true,
                        status_code: '501',
                        token: token,
                        message: 'New Access Token Provided and GCM key updated'
                    });
                });
        })
        .catch((err) => {
            if (err) console.error(err);
            let newUser = new User({
                name: req.body.name,
                pic_url: req.body.pic_url,
                google_id: req.body.google_id,
                gcm_key: req.body.gcm_key,
                email_id: req.body.email_id,
                access_token: ''
            });
            let token = jwt.sign(newUser.email_id, app.get('superSecret'));
            newUser.access_token = token;
            newUser.save()
                .then(() => {
                    console.log('User saved successfully');
                    res.json({
                        success: true,
                        status_code: '501',
                        message: 'User Added.',
                        token: token
                    });
                })
                .catch((err) => {
                    if (err) console.error(err);
                    res.json({
                        success: false,
                        status_code: '403',
                        message: 'Failed to add user',
                        error: err,
                    });
                })
        });
});

apiRoutes.use((req, res, next) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    if (token) {
        jwt.verify(token, app.get('superSecret'), (err, decoded) => {
            if (err) {
                return res.json({
                    success: false,
                    success_code: '401',
                    message: 'Failed to authenticate token.'
                });
            } else {
                req.decoded = decoded;
                next();
            }
        });
    } else {
        return res.status(403).send({
            success: false,
            success_code: '403',
            message: 'No token provided.'
        });

    }
});

apiRoutes.post('/connect-friend', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let friend_email_id = req.body.friend_email_id;
    User.findOne({
            access_token: token
        }).exec()
        .then((user) => {
            let senderUser = user.name
            User.findOne({
                    email_id: friend_email_id
                }).exec()
                .then((user) => {
                    let reg_token = [user.gcm_key];
                    let message = new gcm.Message({
                        collapseKey: 'demo',
                        priority: 'high',
                        contentAvailable: true,
                        delayWhileIdle: true,
                        timeToLive: 3,
                        dryRun: true,
                        data: {
                            key1: 'message1',
                            key2: 'message2'
                        },
                        notification: {
                            title: "Find Friends",
                            icon: "find-friends",
                            body: senderUser + " requesting you to share your location."
                        }
                    });
                    sender.send(message, {
                        registrationTokens: reg_token
                    }, (err, response) => {
                        if (err) console.error(err);
                        else {
                            console.log(response);
                            res.json({
                                success: true,
                                status_code: 501,
                                message: 'Push Notification sent to User'
                            });
                        };
                    });
                })
                .catch((err) => {
                    if (err) console.error(err);
                    res.json({
                        success: false,
                        status_code: 501,
                        message: 'Friend does not exists'
                    });
                });
        })
        .catch((err) => {
            if (err) console.error(err);
            res.json({
                success: false,
                status_code: 401,
                message: 'Error'
            });
        });
});

apiRoutes.post('/friend-request', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let email_id = req.body.email_id;
    let status = req.body.status;
    if (status === 'Allowed') {
        User.findOne({
            access_token: token
        }, (err, user) => {
            if (err) throw err;
            let mapping = new Mapping({
                email_id: email_id,
                friend_email_id: user.email_id
            });
            mapping.save((err) => {
                if (err) throw err;
                console.log('Mapping saved successfully');
                res.json({
                    success: true,
                    status_code: 501,
                    message: 'Request Accepted'
                });
            });
        });
    } else if (status === 'Denied') {
        res.json({
            success: false,
            status_code: 403,
            message: 'Request Denied'
        });
    }
});

apiRoutes.post('/disconnect', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let friend_email_id = req.body.friend_email_id;
    if (!friend_email_id) {
        User.findOne({
            access_token: token
        }, (err, user) => {
            if (err) throw err;
            User.findOne({
                email_id: user.email_id
            }, (err, user) => {
                if (err) throw err;
                Mapping.remove({
                    email_id: user.email_id
                }, (err) => {
                    if (err) throw err;
                    res.json({
                        status: 501,
                        message: 'All friends disconnected'
                    });
                });
            })
        });
    } else {
        User.findOne({
            access_token: token
        }, (err, user) => {
            if (err) throw err;
            User.findOne({
                email_id: user.email_id
            }, (err, user) => {
                if (err) throw err;
                Mapping.remove({
                    email_id: user.email_id,
                    friend_email_id: friend_email_id
                }, (err) => {
                    if (err) throw err;
                    res.json({
                        status: 501,
                        message: 'Friend disconnected'
                    });
                });
            })
        });
    }
});

apiRoutes.get('/get-connected', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    User.findOne({
        access_token: token
    }, (err, user) => {
        if (err) throw err;
        Mapping.find({
            email_id: user.email_id
        }, (err, data) => {
            let friend = [];
            data.map(o => User.find({
                email_id: o.friend_email_id
            }, (err, user) => {
                if (err) throw err;
                if (user) {
                    friend.push(user.map(o => ({
                        'name': o.name,
                        'pic_url': o.pic_url,
                        'email_id': o.email_id,
                    })));
                }
            }));
            setTimeout(() => {
                res.json({
                    success: true,
                    status_code: 501,
                    data: friend
                })
            }, 1000);
        })

    });
});

apiRoutes.post('/update-my-location', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let latitude = req.body.latitude;
    let longitude = req.body.longitude;
    User.findOne({
        access_token: token
    }, (err, user) => {
        if (err) throw err;
        Location.findOne({
            email_id: user.email_id
        }, (err, location) => {
            if (err) throw err;
            if (!location) {
                let newLocation = new Location({
                    email_id: user.email_id,
                    latitude: latitude,
                    longitude: longitude
                });
                newLocation.save((err) => {
                    if (err) throw err;
                    console.log('Location saved successfully');
                    res.json({
                        success: true,
                        status_code: 501,
                        message: 'Location Added'
                    });
                });
            } else {
                Location.update({
                    email_id: location.email_id
                }, {
                    latitude: latitude,
                    longitude: longitude
                }, {
                    upsert: true
                }, (err) => {
                    if (err) throw err;
                    else {
                        res.json({
                            success: true,
                            status_code: 501,
                            message: 'Location Updated'
                        });
                    }
                });
            }
        })
    });
});

apiRoutes.get('/test', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    User.findOne({
            access_token: token
        }).exec()
        .then((user) => {
            return User.findOne({
                email_id: user.id
            }).exec();
        })
        .then((user) => {
            res.json({
                user
            })
        })
        .catch(() => {
            res.json({
                error: 'User not found'
            })
        });
});

app.use('/api', apiRoutes);

app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'https') {
        res.redirect('http://' + req.hostname + req.url);
    } else {
        next();
    }
});

app.listen(port);
console.log('Server started at http://localhost:' + port);